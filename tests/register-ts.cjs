const fs = require('node:fs')
const ts = require('typescript')

// Tests run source in memory; production types are checked separately by npm run typecheck.
require.extensions['.ts'] = (mod, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  })
  mod._compile(result.outputText, filename)
}
