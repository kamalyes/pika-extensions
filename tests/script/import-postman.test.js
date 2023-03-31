import { importFunc as postManImportFunc } from '../../packages/import-postman/src/index'
const json = require('../mocks/postman.json')
const result = postManImportFunc(json)
