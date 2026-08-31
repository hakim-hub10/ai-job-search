const unsupportedLocationFlags = new Set(["--location", "--municipality", "--city"])

if (process.argv.some((argument) => unsupportedLocationFlags.has(argument))) {
  console.error("unsupported Jobnet location flag")
  process.exit(1)
}

console.log(JSON.stringify({ results: [] }))
