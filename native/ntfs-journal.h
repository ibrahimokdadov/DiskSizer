// Experimental, read-only NTFS journal access. Not connected to renderer IPC.
#include <winioctl.h>
#include <charconv>
#include <limits>

class NtfsJournalWorker : public Napi::AsyncWorker {
public:
  NtfsJournalWorker(Napi::Env env, std::wstring root, bool read, ULONGLONG journal, USN start)
    : Napi::AsyncWorker(env), promise_(Napi::Promise::Deferred::New(env)), root_(std::move(root)), read_(read), journal_(journal), start_(start) {}
  Napi::Promise Promise() { return promise_.Promise(); }
  void Execute() override {
    wchar_t filesystem[32]{};
    if (!GetVolumeInformationW(root_.c_str(), nullptr, 0, nullptr, nullptr, nullptr, filesystem, 32)) { Fail(GetLastError()); return; }
    if (wcscmp(filesystem, L"NTFS") != 0 || GetDriveTypeW(root_.c_str()) == DRIVE_REMOTE) {
      reason_ = "A local NTFS volume is required."; if (read_) SetError(reason_); return;
    }
    const auto device = L"\\\\.\\" + root_.substr(0, 2);
    HANDLE handle = CreateFileW(device.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      nullptr, OPEN_EXISTING, 0, nullptr);
    if (handle == INVALID_HANDLE_VALUE) { Fail(GetLastError()); return; }
    // All exits after this point close the read-only volume handle.
    Inspect(handle);
    CloseHandle(handle);
  }
  void OnOK() override {
    auto result = Napi::Object::New(Env());
    result.Set("available", available_); result.Set("root", WideToUtf8(root_.c_str()));
    if (!available_) { result.Set("reason", reason_); result.Set("win32Error", error_); }
    else {
      std::ostringstream volume; volume << std::hex << static_cast<ULONGLONG>(volume_.VolumeSerialNumber.QuadPart);
      result.Set("volumeId", volume.str()); result.Set("journalId", std::to_string(info_.UsnJournalID));
      result.Set("firstUsn", std::to_string(info_.FirstUsn)); result.Set("lowestValidUsn", std::to_string(info_.LowestValidUsn));
      result.Set("nextUsn", std::to_string(info_.NextUsn)); result.Set("mftRecordBytes", volume_.BytesPerFileRecordSegment);
      if (read_) result.Set("data", Napi::Buffer<char>::Copy(Env(), data_.data(), bytes_));
    }
    promise_.Resolve(result);
  }
  void OnError(const Napi::Error& error) override { promise_.Reject(error.Value()); }
private:
  void Fail(DWORD code) {
    error_ = code; reason_ = ErrorText(code);
    if (code == ERROR_ACCESS_DENIED) reason_ = "NTFS journal/MFT access requires an elevated read-only helper. " + reason_;
    if (read_) SetError(reason_);
  }
  void Inspect(HANDLE handle) {
    DWORD returned = 0;
    if (!DeviceIoControl(handle, FSCTL_GET_NTFS_VOLUME_DATA, nullptr, 0, &volume_, sizeof(volume_), &returned, nullptr)) { Fail(GetLastError()); return; }
    if (!DeviceIoControl(handle, FSCTL_QUERY_USN_JOURNAL, nullptr, 0, &info_, sizeof(info_), &returned, nullptr)) { Fail(GetLastError()); return; }
    if (!read_) { available_ = true; return; }
    if (journal_ != info_.UsnJournalID || start_ < (std::max)(info_.FirstUsn, info_.LowestValidUsn) || start_ > info_.NextUsn) {
      SetError("The journal checkpoint is no longer valid; rebuild the index."); return;
    }
    READ_USN_JOURNAL_DATA_V1 request{};
    request.StartUsn = start_; request.UsnJournalID = journal_; request.ReasonMask = 0xffffffff;
    request.MinMajorVersion = 2; request.MaxMajorVersion = 3;
    // Timeout and BytesToWaitFor remain zero: this is a bounded, non-waiting read.
    data_.resize(64 * 1024);
    if (!DeviceIoControl(handle, FSCTL_READ_USN_JOURNAL, &request, sizeof(request), data_.data(),
      static_cast<DWORD>(data_.size()), &bytes_, nullptr)) { Fail(GetLastError()); return; }
    if (bytes_ < sizeof(USN) || bytes_ > data_.size()) { SetError("Invalid USN response length."); return; }
    USN_JOURNAL_DATA_V0 after{};
    if (!DeviceIoControl(handle, FSCTL_QUERY_USN_JOURNAL, nullptr, 0, &after, sizeof(after), &returned, nullptr)) { Fail(GetLastError()); return; }
    if (after.UsnJournalID != journal_ || start_ < (std::max)(after.FirstUsn, after.LowestValidUsn)) {
      SetError("Journal history changed during the read; rebuild the index."); return;
    }
    available_ = true;
  }
  Napi::Promise::Deferred promise_;
  std::wstring root_; bool read_, available_ = false; ULONGLONG journal_; USN start_;
  DWORD error_ = 0, bytes_ = 0; std::string reason_; std::vector<char> data_;
  NTFS_VOLUME_DATA_BUFFER volume_{}; USN_JOURNAL_DATA_V0 info_{};
};

static Napi::Value NtfsJournalCall(const Napi::CallbackInfo& info, bool read) {
  auto env = info.Env();
  if (info.Length() != (read ? 3u : 1u) || !info[0].IsString()) {
    Napi::TypeError::New(env, "A local drive root is required.").ThrowAsJavaScriptException(); return env.Undefined();
  }
  auto root = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  if (root.size() != 3 || !iswalpha(root[0]) || root[1] != L':' || root[2] != L'\\') {
    Napi::TypeError::New(env, "Use a local drive root such as C:\\.").ThrowAsJavaScriptException(); return env.Undefined();
  }
  ULONGLONG numbers[2]{};
  if (read) for (int i = 0; i < 2; i++) {
    if (!info[i + 1].IsString()) { Napi::TypeError::New(env, "Journal identifiers must be decimal strings.").ThrowAsJavaScriptException(); return env.Undefined(); }
    const auto text = info[i + 1].As<Napi::String>().Utf8Value();
    auto parsed = std::from_chars(text.data(), text.data() + text.size(), numbers[i]);
    if (text.empty() || parsed.ec != std::errc() || parsed.ptr != text.data() + text.size() ||
        (i == 1 && numbers[i] > static_cast<ULONGLONG>((std::numeric_limits<LONGLONG>::max)()))) {
      Napi::TypeError::New(env, "Invalid journal checkpoint.").ThrowAsJavaScriptException(); return env.Undefined();
    }
  }
  auto worker = new NtfsJournalWorker(env, root, read, numbers[0], static_cast<USN>(numbers[1]));
  auto promise = worker->Promise(); worker->Queue(); return promise;
}
static Napi::Value ProbeNtfs(const Napi::CallbackInfo& info) { return NtfsJournalCall(info, false); }
static Napi::Value ReadNtfsJournal(const Napi::CallbackInfo& info) { return NtfsJournalCall(info, true); }
