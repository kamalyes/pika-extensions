import { importFunc as openapiImportFunc } from '../../packages/import-openapi/src/index'
const json = require('../mocks/openapi.json')
console.log("json",json)
const result = openapiImportFunc(json)
