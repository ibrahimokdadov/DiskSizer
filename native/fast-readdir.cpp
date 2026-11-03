// Buffered Win32 metadata enumeration. File lengths arrive with directory
// entries; no separate file stat is needed. This does not imply one disk I/O.
#include <napi.h>
#include <windows.h>
#include <algorithm>
#include <cwctype>
#include <string>
#include <unordered_set>
#include <vector>

struct DirEntry {
  std::string name;
  double size;
  double mtime;
  bool isDir;
  bool isSymlink;
  std::string skipReason;
};

static std::string WideToUtf8(const wchar_t* value) {
  if (!value || !value[0]) return "";
  int length = static_cast<int>(wcslen(value));
  int bytes = WideCharToMultiByte(CP_UTF8, 0, value, length, nullptr, 0, nullptr, nullptr);
  std::string result(bytes, '\0');
  if (bytes) WideCharToMultiByte(CP_UTF8, 0, value, length, &result[0], bytes, nullptr, nullptr);
  return result;
}

static std::wstring Utf8ToWide(const std::string& value) {
  int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.c_str(), static_cast<int>(value.size()), nullptr, 0);
  if (!length) return L"";
  std::wstring result(length, L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.c_str(), static_cast<int>(value.size()), &result[0], length);
  return result;
}

static std::string ErrorText(DWORD code) {
  wchar_t* buffer = nullptr;
  FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
    nullptr, code, 0, reinterpret_cast<LPWSTR>(&buffer), 0, nullptr);
  std::string message = buffer ? WideToUtf8(buffer) : "Unknown Windows error";
  if (buffer) LocalFree(buffer);
  while (!message.empty() && (message.back() == '\n' || message.back() == '\r')) message.pop_back();
  return message + " (Win32 error " + std::to_string(code) + ")";
}

static std::wstring ExtendedPath(std::wstring value) {
  std::replace(value.begin(), value.end(), L'/', L'\\');
  if (value.compare(0, 4, L"\\\\?\\") == 0) return value;
  if (value.compare(0, 2, L"\\\\") == 0) return L"\\\\?\\UNC\\" + value.substr(2);
  if (value.size() >= 3 && value[1] == L':' && value[2] == L'\\') return L"\\\\?\\" + value;
  return value;
}

class ReaddirWorker : public Napi::AsyncWorker {
public:
  ReaddirWorker(Napi::Env env, std::string path, Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(env), path_(std::move(path)), deferred_(deferred) {}

  void Execute() override {
    std::wstring dir = ExtendedPath(Utf8ToWide(path_));
    if (dir.empty()) { SetError("Invalid UTF-8 directory path."); return; }
    DWORD rootAttributes = GetFileAttributesW(dir.c_str());
    if (rootAttributes != INVALID_FILE_ATTRIBUTES && (rootAttributes & FILE_ATTRIBUTE_DIRECTORY) && (rootAttributes & 0x00400000UL)) {
      SetError("Cloud folder contents are not available locally; not recalled during this scan.");
      return;
    }
    std::wstring search = dir;
    if (search.back() != L'\\') search += L'\\';
    search += L'*';

    WIN32_FIND_DATAW data;
    HANDLE handle = FindFirstFileExW(search.c_str(), FindExInfoBasic, &data, FindExSearchNameMatch, nullptr, FIND_FIRST_EX_LARGE_FETCH);
    if (handle == INVALID_HANDLE_VALUE && (GetLastError() == ERROR_INVALID_PARAMETER || GetLastError() == ERROR_NOT_SUPPORTED)) {
      handle = FindFirstFileExW(search.c_str(), FindExInfoBasic, &data, FindExSearchNameMatch, nullptr, 0);
    }
    if (handle == INVALID_HANDLE_VALUE) {
      DWORD error = GetLastError();
      // Some providers return no wildcard match for an existing empty folder.
      if (error == ERROR_FILE_NOT_FOUND) {
        DWORD attributes = GetFileAttributesW(dir.c_str());
        if (attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY)) return;
      }
      SetError(ErrorText(error));
      return;
    }

    do {
      if (wcscmp(data.cFileName, L".") == 0 || wcscmp(data.cFileName, L"..") == 0) continue;
      bool isDir = (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
      bool isReparse = (data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
      // The name-surrogate bit identifies links/junctions, unlike cloud and
      // compression reparse tags which still represent the file itself.
      bool isLink = isReparse && (data.dwReserved0 & 0x20000000UL) != 0;
      std::string skipReason;
      if (isDir && (data.dwFileAttributes & 0x00400000UL)) {
        skipReason = "Cloud folder contents are not available locally; not recalled during this scan.";
      }
      ULONGLONG size = isDir ? 0ULL : (static_cast<ULONGLONG>(data.nFileSizeHigh) << 32) | data.nFileSizeLow;
      ULONGLONG time = (static_cast<ULONGLONG>(data.ftLastWriteTime.dwHighDateTime) << 32) | data.ftLastWriteTime.dwLowDateTime;
      double mtime = time > 116444736000000000ULL ? static_cast<double>(time - 116444736000000000ULL) / 10000.0 : 0.0;
      entries_.push_back({ WideToUtf8(data.cFileName), static_cast<double>(size), mtime, isDir, isLink, skipReason });
    } while (FindNextFileW(handle, &data));

    DWORD error = GetLastError();
    FindClose(handle);
    if (error != ERROR_NO_MORE_FILES) SetError(ErrorText(error));
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Array result = Napi::Array::New(env, entries_.size());
    for (size_t index = 0; index < entries_.size(); index++) {
      const auto& entry = entries_[index];
      Napi::Object item = Napi::Object::New(env);
      item.Set("name", entry.name);
      item.Set("size", entry.size);
      item.Set("mtime", entry.mtime);
      item.Set("isDir", entry.isDir);
      item.Set("isSymlink", entry.isSymlink);
      if (!entry.skipReason.empty()) item.Set("skipReason", entry.skipReason);
      result[index] = item;
    }
    deferred_.Resolve(result);
  }
  void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

private:
  std::string path_;
  Napi::Promise::Deferred deferred_;
  std::vector<DirEntry> entries_;
};

struct Volume {
  std::string root, label, fileSystem, id, type;
  double total = 0, free = 0;
  bool available = false;
};

class VolumeWorker : public Napi::AsyncWorker {
public:
  VolumeWorker(Napi::Env env, Napi::Promise::Deferred deferred) : Napi::AsyncWorker(env), deferred_(deferred) {}

  void Execute() override {
    DWORD oldMode = 0;
    SetThreadErrorMode(SEM_FAILCRITICALERRORS, &oldMode);
    wchar_t name[MAX_PATH];
    HANDLE handle = FindFirstVolumeW(name, MAX_PATH);
    if (handle != INVALID_HANDLE_VALUE) {
      do {
        DWORD required = 0;
        GetVolumePathNamesForVolumeNameW(name, nullptr, 0, &required);
        if (!required) continue;
        std::vector<wchar_t> paths(required);
        if (!GetVolumePathNamesForVolumeNameW(name, paths.data(), required, &required)) continue;
        std::wstring preferred;
        for (const wchar_t* mount = paths.data(); *mount; mount += wcslen(mount) + 1) {
          std::wstring root(mount);
          if (preferred.empty() || root.size() < preferred.size()) preferred = root;
          seen_.insert(Lower(root));
        }
        if (!preferred.empty()) Add(preferred, name);
      } while (FindNextVolumeW(handle, name, MAX_PATH));
      FindVolumeClose(handle);
    }
    // Volume APIs omit mapped network drives; include logical drives separately.
    DWORD length = GetLogicalDriveStringsW(0, nullptr);
    if (length) {
      std::vector<wchar_t> roots(length + 1);
      if (GetLogicalDriveStringsW(length, roots.data())) {
        for (const wchar_t* root = roots.data(); *root; root += wcslen(root) + 1) {
          if (seen_.insert(Lower(root)).second) Add(root, L"");
        }
      }
    }
    SetThreadErrorMode(oldMode, nullptr);
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Array result = Napi::Array::New(env, volumes_.size());
    for (size_t index = 0; index < volumes_.size(); index++) {
      const auto& volume = volumes_[index];
      Napi::Object item = Napi::Object::New(env);
      item.Set("letter", volume.root);
      item.Set("label", volume.label);
      item.Set("totalSize", volume.total);
      item.Set("freeSpace", volume.free);
      item.Set("fileSystem", volume.fileSystem);
      item.Set("volumeId", volume.id);
      item.Set("driveType", volume.type);
      item.Set("available", volume.available);
      result[index] = item;
    }
    deferred_.Resolve(result);
  }
  void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

private:
  static std::wstring Lower(std::wstring value) {
    std::transform(value.begin(), value.end(), value.begin(), [](wchar_t c) { return static_cast<wchar_t>(towlower(c)); });
    return value;
  }
  void Add(const std::wstring& root, const std::wstring& id) {
    Volume volume;
    volume.root = WideToUtf8(root.c_str());
    volume.id = WideToUtf8(id.c_str());
    UINT type = GetDriveTypeW(root.c_str());
    volume.type = type == DRIVE_FIXED ? "fixed" : type == DRIVE_REMOVABLE ? "removable" : type == DRIVE_REMOTE ? "network" : type == DRIVE_CDROM ? "optical" : "unknown";
    ULARGE_INTEGER available, total, free;
    volume.available = GetDiskFreeSpaceExW(root.c_str(), &available, &total, &free) != 0;
    if (volume.available) {
      volume.total = static_cast<double>(total.QuadPart);
      volume.free = static_cast<double>(available.QuadPart);
      wchar_t label[MAX_PATH] = {}, fileSystem[MAX_PATH] = {};
      if (GetVolumeInformationW(root.c_str(), label, MAX_PATH, nullptr, nullptr, nullptr, fileSystem, MAX_PATH)) {
        volume.label = WideToUtf8(label);
        volume.fileSystem = WideToUtf8(fileSystem);
      }
    }
    volumes_.push_back(std::move(volume));
  }
  Napi::Promise::Deferred deferred_;
  std::unordered_set<std::wstring> seen_;
  std::vector<Volume> volumes_;
};

static Napi::Value ReaddirWithStats(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "A directory path is required.").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto deferred = Napi::Promise::Deferred::New(env);
  (new ReaddirWorker(env, info[0].As<Napi::String>().Utf8Value(), deferred))->Queue();
  return deferred.Promise();
}

static Napi::Value GetVolumes(const Napi::CallbackInfo& info) {
  auto deferred = Napi::Promise::Deferred::New(info.Env());
  (new VolumeWorker(info.Env(), deferred))->Queue();
  return deferred.Promise();
}

#include "directory-cursor.h"

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("apiVersion", 3);
  DirectoryCursor::Export(env, exports);
  exports.Set("readdirWithStats", Napi::Function::New(env, ReaddirWithStats));
  exports.Set("getVolumes", Napi::Function::New(env, GetVolumes));
  return exports;
}

NODE_API_MODULE(fast_readdir, Init)
