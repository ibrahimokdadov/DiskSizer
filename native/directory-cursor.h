// Bounded, allocation-aware directory enumeration. The cursor is owned by one
// JS consumer; Ref/Unref keeps it alive while a worker is reading its handle.
#include <sstream>
#include <iomanip>
#include <cstring>

class DirectoryCursor : public Napi::ObjectWrap<DirectoryCursor> {
  struct Entry {
    std::string name, identity, skip;
    double size = 0, allocated = 0, modified = 0;
    bool directory = false, link = false, measured = false;
  };
  class ReadWorker : public Napi::AsyncWorker {
  public:
    ReadWorker(DirectoryCursor* cursor, Napi::Env env)
      : Napi::AsyncWorker(env), cursor_(cursor), promise_(Napi::Promise::Deferred::New(env)) {}
    Napi::Promise Promise() { return promise_.Promise(); }
    void Execute() override { cursor_->Read(entries_, error_); if (!error_.empty()) SetError(error_); }
    void OnOK() override {
      auto env = Env(); auto entries = Napi::Array::New(env, entries_.size());
      for (size_t i = 0; i < entries_.size(); ++i) {
        const auto& e = entries_[i]; auto item = Napi::Object::New(env);
        item.Set("name", e.name); item.Set("size", e.size); item.Set("mtime", e.modified);
        item.Set("isDir", e.directory); item.Set("isSymlink", e.link);
        if (e.measured) item.Set("allocatedSize", e.allocated);
        if (!e.identity.empty()) item.Set("fileIdentity", e.identity);
        if (!e.skip.empty()) item.Set("skipReason", e.skip);
        entries[i] = item;
      }
      auto result = Napi::Object::New(env); result.Set("entries", entries); result.Set("done", cursor_->done_);
      cursor_->busy_ = false; promise_.Resolve(result); cursor_->Unref();
    }
    void OnError(const Napi::Error& error) override {
      cursor_->busy_ = false; cursor_->Close(); promise_.Reject(error.Value()); cursor_->Unref();
    }
  private:
    DirectoryCursor* cursor_; Napi::Promise::Deferred promise_;
    std::vector<Entry> entries_; std::string error_;
  };
public:
  static void Export(Napi::Env env, Napi::Object exports) {
    exports.Set("DirectoryCursor", DefineClass(env, "DirectoryCursor", {
      InstanceMethod("read", &DirectoryCursor::ReadAsync), InstanceMethod("close", &DirectoryCursor::CloseJS)
    }));
  }
  explicit DirectoryCursor(const Napi::CallbackInfo& info) : Napi::ObjectWrap<DirectoryCursor>(info), buffer_(8192) {
    if (!info.Length() || !info[0].IsString()) {
      Napi::TypeError::New(info.Env(), "A directory path is required.").ThrowAsJavaScriptException(); return;
    }
    path_ = ExtendedPath(Utf8ToWide(info[0].As<Napi::String>().Utf8Value()));
  }
  ~DirectoryCursor() { Close(); }
private:
  std::wstring path_; HANDLE handle_ = INVALID_HANDLE_VALUE, find_ = INVALID_HANDLE_VALUE;
  std::vector<unsigned long long> buffer_; size_t offset_ = 0;
  bool initialized_ = false, buffered_ = false, fallback_ = false, done_ = false, busy_ = false;
  std::string volume_; WIN32_FIND_DATAW found_{}; bool first_ = true;
  void Close() {
    if (handle_ != INVALID_HANDLE_VALUE) { CloseHandle(handle_); handle_ = INVALID_HANDLE_VALUE; }
    if (find_ != INVALID_HANDLE_VALUE) { FindClose(find_); find_ = INVALID_HANDLE_VALUE; }
    done_ = true;
  }
  Napi::Value CloseJS(const Napi::CallbackInfo& info) {
    if (busy_) Napi::Error::New(info.Env(), "A directory read is still running.").ThrowAsJavaScriptException();
    else Close();
    return info.Env().Undefined();
  }
  Napi::Value ReadAsync(const Napi::CallbackInfo& info) {
    if (busy_) { Napi::Error::New(info.Env(), "Concurrent reads are not supported.").ThrowAsJavaScriptException(); return info.Env().Undefined(); }
    busy_ = true; Ref(); auto worker = new ReadWorker(this, info.Env()); auto promise = worker->Promise(); worker->Queue(); return promise;
  }
  static std::string Identity(ULONGLONG volume, const FILE_ID_128& id) {
    bool nonzero = false; std::ostringstream out; out << std::hex << volume << ':';
    for (auto byte : id.Identifier) { nonzero |= byte != 0; out << std::setw(2) << std::setfill('0') << static_cast<unsigned>(byte); }
    return nonzero ? out.str() : "";
  }
  static double Milliseconds(LONGLONG time) { return time > 116444736000000000LL ? static_cast<double>(time - 116444736000000000LL) / 10000.0 : 0; }
  void Complete(Entry& entry, DWORD attributes, DWORD tag) {
    entry.directory = (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
    entry.link = (attributes & FILE_ATTRIBUTE_REPARSE_POINT) && (tag & 0x20000000UL);
    if (entry.directory && (attributes & 0x00400000UL)) entry.skip = "Cloud folder contents are not available locally; not recalled during this scan.";
    if (!entry.directory && !entry.link && (attributes & (FILE_ATTRIBUTE_COMPRESSED | FILE_ATTRIBUTE_SPARSE_FILE))) {
      auto full = path_ + L"\\" + Utf8ToWide(entry.name); DWORD high = 0; SetLastError(ERROR_SUCCESS);
      DWORD low = GetCompressedFileSizeW(full.c_str(), &high);
      entry.measured = low != INVALID_FILE_SIZE || GetLastError() == ERROR_SUCCESS;
      if (entry.measured) entry.allocated = static_cast<double>((static_cast<ULONGLONG>(high) << 32) | low);
    }
  }
  void Read(std::vector<Entry>& entries, std::string& error) {
    if (done_) return;
    if (!initialized_) {
      initialized_ = true;
      DWORD attrs = GetFileAttributesW(path_.c_str());
      if (attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY) && (attrs & 0x00400000UL)) {
        error = "Cloud folder contents are not available locally; not recalled during this scan."; return;
      }
      handle_ = CreateFileW(path_.c_str(), FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
      if (handle_ == INVALID_HANDLE_VALUE) { error = ErrorText(GetLastError()); return; }
      FILE_ID_INFO id{};
      if (GetFileInformationByHandleEx(handle_, FileIdInfo, &id, sizeof(id))) volume_ = std::to_string(id.VolumeSerialNumber);
    }
    while (entries.size() < 256 && !done_) {
      Entry entry;
      if (!fallback_) {
        if (!buffered_) {
          if (!GetFileInformationByHandleEx(handle_, FileIdExtdDirectoryInfo, buffer_.data(), static_cast<DWORD>(buffer_.size() * sizeof(unsigned long long)))) {
            DWORD code = GetLastError();
            if (code == ERROR_NO_MORE_FILES) { Close(); break; }
            if (entries.empty() && first_ && (code == ERROR_INVALID_PARAMETER || code == ERROR_NOT_SUPPORTED || code == ERROR_INVALID_FUNCTION)) { fallback_ = true; continue; }
            error = ErrorText(code); return;
          }
          offset_ = 0; buffered_ = true;
        }
        const size_t bytes = buffer_.size() * sizeof(unsigned long long);
        const size_t header = offsetof(FILE_ID_EXTD_DIR_INFO, FileName);
        if (offset_ > bytes - header) { error = "Invalid directory record."; return; }
        auto info = reinterpret_cast<FILE_ID_EXTD_DIR_INFO*>(reinterpret_cast<char*>(buffer_.data()) + offset_);
        if (info->FileNameLength % 2 || info->FileNameLength > bytes - offset_ - header ||
            (info->NextEntryOffset && (info->NextEntryOffset < header + info->FileNameLength || info->NextEntryOffset > bytes - offset_ || info->NextEntryOffset % 8))) {
          error = "Invalid directory record length."; return;
        }
        std::wstring name(info->FileName, info->FileNameLength / sizeof(wchar_t));
        entry.name = WideToUtf8(name.c_str()); entry.size = static_cast<double>(std::max<LONGLONG>(0, info->EndOfFile.QuadPart));
        entry.allocated = static_cast<double>(std::max<LONGLONG>(0, info->AllocationSize.QuadPart)); entry.measured = true;
        entry.modified = Milliseconds(info->LastWriteTime.QuadPart);
        if (!volume_.empty()) entry.identity = Identity(std::stoull(volume_), info->FileId);
        Complete(entry, info->FileAttributes, info->ReparsePointTag);
        if (info->NextEntryOffset) offset_ += info->NextEntryOffset; else buffered_ = false;
        first_ = false;
      } else {
        if (find_ == INVALID_HANDLE_VALUE) {
          find_ = FindFirstFileExW((path_ + L"\\*").c_str(), FindExInfoBasic, &found_, FindExSearchNameMatch, nullptr, 0);
          if (find_ == INVALID_HANDLE_VALUE) { DWORD code = GetLastError(); if (code == ERROR_FILE_NOT_FOUND) { Close(); break; } error = ErrorText(code); return; }
        } else if (!FindNextFileW(find_, &found_)) {
          DWORD code = GetLastError(); if (code == ERROR_NO_MORE_FILES) { Close(); break; } error = ErrorText(code); return;
        }
        entry.name = WideToUtf8(found_.cFileName);
        entry.size = static_cast<double>((static_cast<ULONGLONG>(found_.nFileSizeHigh) << 32) | found_.nFileSizeLow);
        entry.modified = Milliseconds((static_cast<ULONGLONG>(found_.ftLastWriteTime.dwHighDateTime) << 32) | found_.ftLastWriteTime.dwLowDateTime);
        if (!(found_.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) {
          HANDLE file = CreateFileW((path_ + L"\\" + found_.cFileName).c_str(), FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
          if (file != INVALID_HANDLE_VALUE) {
            FILE_STANDARD_INFO standard{}; FILE_ID_INFO id{};
            if (GetFileInformationByHandleEx(file, FileStandardInfo, &standard, sizeof(standard))) { entry.allocated = static_cast<double>(std::max<LONGLONG>(0, standard.AllocationSize.QuadPart)); entry.measured = true; }
            if (GetFileInformationByHandleEx(file, FileIdInfo, &id, sizeof(id))) entry.identity = Identity(id.VolumeSerialNumber, id.FileId);
            CloseHandle(file);
          }
        }
        Complete(entry, found_.dwFileAttributes, found_.dwReserved0);
      }
      if (entry.name != "." && entry.name != "..") entries.push_back(std::move(entry));
    }
  }
};
