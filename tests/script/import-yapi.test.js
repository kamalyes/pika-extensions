import { importFunc as yApiImportFunc } from '../../packages/import-yapi/src/index'
const json = require('../mocks/yapi.json')
const result = yApiImportFunc(json)
