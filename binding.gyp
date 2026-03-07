{
  "targets": [{
    "target_name": "fast_readdir",
    "sources": ["native/fast-readdir.cpp"],
    "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
    "conditions": [
      ["OS=='win'", {
        "msvs_settings": {
          "VCCLCompilerTool": {
            "ExceptionHandling": 0,
            "AdditionalOptions": ["/std:c++17"]
          }
        }
      }]
    ]
  }]
}
