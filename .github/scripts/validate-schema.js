const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const sourceFile = path.join(process.cwd(), 'plugins-source.json');
const schemaFile = path.join(process.cwd(), 'schemas', 'plugins-source.schema.json');

if (!fs.existsSync(sourceFile)) {
  console.error('Error: plugins-source.json not found');
  process.exit(1);
}

if (!fs.existsSync(schemaFile)) {
  console.error('Error: Schema file not found');
  process.exit(1);
}

const sourceData = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const validate = ajv.compile(schema);
const valid = validate(sourceData);

if (!valid) {
  console.error('JSON Schema validation failed:');
  console.error(JSON.stringify(validate.errors, null, 2));
  process.exit(1);
}

console.log('✅ JSON schema validation passed');
process.exit(0);

