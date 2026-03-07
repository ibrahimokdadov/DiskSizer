/**
 * fast-readdir — native N-API addon for Windows
 *
 * Uses FindFirstFileExW with FIND_FIRST_EX_LARGE_FETCH + FindExInfoBasic to
 * enumerate directory entries and return file sizes directly from WIN32_FIND_DATA.
 *
 * Why this matters on HDDs:
 *   fs.readdir() gives us names but no sizes.
 *   fs.stat() per file = one random seek per file (~10ms on HDD).
 *   FindFirstFileEx returns both name AND size from the same directory read,
 *   eliminating all per-file stat() syscalls.
 *   For a directory with 1000 files: 1001 I/O ops → 1 I/O op.
 */

#include <napi.h>
#include <windows.h>
#include <string>
#include <vector>

struct DirEntry {
  std::string name;
  double      size;
  double      mtime;
  bool        isDir;
  bool        isSymlink;
};

static std::string WideToUtf8(const wchar_t* wstr) {
  if (!wstr || !wstr[0]) return "";
  int size = WideCharToMultiByte(CP_UTF8, 0, wstr, -1, nullptr, 0, nullptr, nullptr);
  if (size <= 1) return "";
  std::string result(size - 1, '\0');
  WideCharToMultiByte(CP_UTF8, 0, wstr, -1, &result[0], size, nullptr, nullptr);
  return result;
}

class ReaddirWorker : public Napi::AsyncWorker {
public:
  ReaddirWorker(Napi::Env env, std::string path, Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(env), path_(std::move(path)), deferred_(deferred) {}

  void Execute() override {
    int wlen = MultiByteToWideChar(CP_UTF8, 0, path_.c_str(), -1, nullptr, 0);
    if (wlen <= 0) return;
    std::wstring wpath(wlen - 1, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, path_.c_str(), -1, &wpath[0], wlen);
    wpath += L"\\*";

    WIN32_FIND_DATAW ffd;
    HANDLE hFind = FindFirstFileExW(
      wpath.c_str(),
      FindExInfoBasic,       // skip 8.3 name — faster
      &ffd,
      FindExSearchNameMatch,
      nullptr,
      FIND_FIRST_EX_LARGE_FETCH  // hint OS to fetch more entries per call
    );

    if (hFind == INVALID_HANDLE_VALUE) return;

    do {
      // skip . and ..
      if (ffd.cFileName[0] == L'.' &&
          (ffd.cFileName[1] == L'\0' ||
           (ffd.cFileName[1] == L'.' && ffd.cFileName[2] == L'\0')))
        continue;

      bool isDir      = (ffd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)    != 0;
      bool isSymlink  = (ffd.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0;

      // Size comes directly from WIN32_FIND_DATA — no stat() call needed
      ULONGLONG size = isDir ? 0ULL :
        ((ULONGLONG)ffd.nFileSizeHigh << 32) | ffd.nFileSizeLow;

      // Last-write time: Windows FILETIME → Unix ms
      ULONGLONG ft = ((ULONGLONG)ffd.ftLastWriteTime.dwHighDateTime << 32) |
                                 ffd.ftLastWriteTime.dwLowDateTime;
      double mtime = ft > 116444736000000000ULL
        ? (double)(ft - 116444736000000000ULL) / 10000.0
        : 0.0;

      std::string name = WideToUtf8(ffd.cFileName);
      if (name.empty()) continue;

      entries_.push_back({ std::move(name), (double)size, mtime, isDir, isSymlink });

    } while (FindNextFileW(hFind, &ffd));

    FindClose(hFind);
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Array result = Napi::Array::New(env, entries_.size());
    for (size_t i = 0; i < entries_.size(); i++) {
      Napi::Object obj = Napi::Object::New(env);
      obj.Set("name",      Napi::String::New(env, entries_[i].name));
      obj.Set("size",      Napi::Number::New(env, entries_[i].size));
      obj.Set("mtime",     Napi::Number::New(env, entries_[i].mtime));
      obj.Set("isDir",     Napi::Boolean::New(env, entries_[i].isDir));
      obj.Set("isSymlink", Napi::Boolean::New(env, entries_[i].isSymlink));
      result[i] = obj;
    }
    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error& e) override {
    deferred_.Reject(e.Value());
  }

private:
  std::string                path_;
  Napi::Promise::Deferred    deferred_;
  std::vector<DirEntry>      entries_;
};

static Napi::Value ReaddirWithStats(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string path = info[0].As<Napi::String>().Utf8Value();
  auto deferred = Napi::Promise::Deferred::New(env);
  (new ReaddirWorker(env, std::move(path), deferred))->Queue();
  return deferred.Promise();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("readdirWithStats", Napi::Function::New(env, ReaddirWithStats));
  return exports;
}

NODE_API_MODULE(fast_readdir, Init)
