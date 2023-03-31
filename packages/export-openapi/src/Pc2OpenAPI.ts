import { OpenAPIV3 } from 'openapi-types'
import { safeJSONParse, safeStringify } from '../../../shared/src/utils/common'
import {
  ApiBodyType,
  apiBodyTypeMap,
  ApiParamsType,
  apiParamsTypeMap,
  ContentType,
  requestMethodMap
} from '../../../shared/src/types/api.model'
import {
  ApiData,
  BodyParam,
  RequestParams,
  ResponseParams
} from '../../../shared/src/types/apiData'
import {
  Collection,
  CollectionTypeEnum,
  ImportProjectDto
} from '../../../shared/src/types/pcAPI'

// const parseParamsInUrl = (url): string[] => {
//   return url.match(/(?<={)(\S)+?(?=})/g) || []
// }

// const setResponseHeader = (data, { apiData, uri, method }: sourceInterface) => {
//   _.set(data, [uri, method.toLowerCase()], responses)
//   return ''
// }

type SchemaObjectType =
  | OpenAPIV3.ArraySchemaObjectType
  | OpenAPIV3.NonArraySchemaObjectType

export const contentTypeMap = new Map([
  [ContentType.JSON_ARRAY, 'application/json'],
  [ContentType.JSON_OBJECT, 'application/json'],
  [ContentType.XML, 'application/xml'],
  [ContentType.FROM_DATA, 'application/x-www-form-urlencode'],
  [ContentType.BINARY, 'multipart/form-data'],
  [ContentType.RAW, 'text/plain']
] as const)

export const parametersInMap = new Map([
  ['queryParams', 'query'],
  ['restParams', 'path'],
  ['headerParams', 'header']
] as const)

const allowedValues = [
  'array',
  'boolean',
  'integer',
  'number',
  'object',
  'string'
]
const getDataType = (
  dataType: ApiParamsType
): OpenAPIV3.NonArraySchemaObjectType | OpenAPIV3.ArraySchemaObjectType => {
  const type = apiParamsTypeMap[dataType]
  if (allowedValues.includes(type)) {
    return type
  }
  if (type?.includes('json')) {
    return 'object'
  }
  return 'string'
}

const getDataTypeByContentType = (contentType: number) => {
  if (ApiBodyType.Binary === contentType) {
    return ApiParamsType.file
  } else if (ApiBodyType.Raw === contentType) {
    return ApiParamsType.string
  } else if (ApiBodyType.JSONArray === contentType) {
    return ApiParamsType.array
  } else {
    return ApiParamsType.json
  }
}

class PcToOpenAPI {
  data: OpenAPIV3.Document
  pikaData: ImportProjectDto
  constructor(pikaData: ImportProjectDto) {
    this.pikaData = pikaData
    const { version, name, description, collections } = this.pikaData

    this.data = {
      openapi: '3.0.1',
      info: {
        // rome-ignore lint/style/noNonNullAssertion: <explanation>
        title: name!,
        description: description || name || '',
        termsOfService: '',
        contact: {},
        license: {
          name: 'Apache 2.0',
          url: 'http://www.apache.org/licenses/LICENSE-2.0.html'
        },
        version: version || '0.0.0'
      },
      externalDocs: {
        description: 'Find out more about Swagger',
        url: 'http://swagger.io'
      },
      servers: [],
      paths: this.generatePaths(collections),
      tags: this.generateTags(collections),
      components: {}
    }
  }

  generatePaths(
    collections: ImportProjectDto['collections'] = [],
    parentGroup?: Collection,
    defaultPaths = {}
  ): OpenAPIV3.PathsObject {
    // const flatGroupList = this.flattenGroupList(groupList)

    return collections.reduce<OpenAPIV3.PathsObject>((paths, item) => {
      if (
        item?.collectionType === CollectionTypeEnum.API_DATA &&
        'uri' in item
      ) {
        // rome-ignore lint/style/noNonNullAssertion: <explanation>
        const { uri, name, apiAttrInfo } = item!
        // rome-ignore lint/style/noNonNullAssertion: <explanation>
        const method = requestMethodMap[apiAttrInfo?.requestMethod!]
        const httpMethod = method.toLowerCase() as OpenAPIV3.HttpMethods
        // rome-ignore lint/style/noNonNullAssertion: <explanation>
        paths[uri!] ??= {}
        // rome-ignore lint/style/noNonNullAssertion: <explanation>
        paths[uri!]![httpMethod] = {
          tags: parentGroup?.name ? [parentGroup?.name] : [],
          summary: name,
          description: name,
          operationId: name,
          parameters: this.generateParameters(item!),
          requestBody: this.generateRequestBody(item!),
          responses: this.generateResponseBody(item!),
          security: []
        }
      } else if (
        item?.collectionType === CollectionTypeEnum.GROUP &&
        'children' in item &&
        item.children?.length
      ) {
        this.generatePaths(item.children, item, paths)
      }

      return paths
    }, defaultPaths)
  }
  generateParameters(
    apiData: ApiData
  ): OpenAPIV3.ParameterObject[] | undefined {
    return [...parametersInMap.keys()].reduce<OpenAPIV3.ParameterObject[]>(
      (prev, key) => {
        const item = apiData?.requestParams?.[key]
        if (item?.length) {
          item.forEach((n) => {
            if (n?.name) {
              prev.push({
                ...this.createBaseSchemaObject(n),
                required: Boolean(n.isRequired),
                // rome-ignore lint/style/noNonNullAssertion: <explanation>
                in: parametersInMap.get(key)!,
                schema: {
                  type: typeof n?.paramAttr
                    ?.example as OpenAPIV3.NonArraySchemaObjectType
                }
              })
            }
          })
        }
        return prev
      },
      []
    )
  }

  generateRequestBody(
    apiData: ApiData
  ): OpenAPIV3.RequestBodyObject | undefined {
    if (!apiData?.requestParams?.bodyParams) {
      return
    }
    const { apiAttrInfo, requestParams } = apiData
    const { contentType: requestContentType, requestMethod } = apiAttrInfo || {}
    const method = requestMethodMap[requestMethod!]
    const contentType = contentTypeMap.get(requestContentType!)
    const requestBodyJsonType = apiBodyTypeMap[requestContentType!]

    if (!contentType) {
      console.log('contentType', contentType, requestBodyJsonType)
      console.error(`Can't parser the content type`)
      return
    }

    if (['DELETE', 'GET'].includes(method)) {
      return
    }

    return {
      content: {
        [contentType]: {
          schema: this.parseToSchema(
            requestParams?.bodyParams,
            getDataTypeByContentType(requestContentType!)
          )
        }
      },
      required:
        requestBodyJsonType.includes('JSON') &&
        Boolean(requestParams?.bodyParams?.length)
    }
  }

  generateResponseBody(apiData: ApiData): OpenAPIV3.ResponsesObject {
    if (!apiData?.responseList?.[0]?.responseParams?.bodyParams?.length) {
      return {}
    }
    const { responseList = [] } = apiData

    if (!responseList.length) {
      return {}
    }

    const { contentType: responseContentType, responseParams } =
      // rome-ignore lint/style/noNonNullAssertion: <explanation>
      responseList?.[0]!
    const { headerParams, bodyParams } = responseParams || {}

    const contentType = contentTypeMap.get(responseContentType!)

    if (!contentType) {
      console.log('contentType', contentType, responseContentType)
      console.error(`Can't parser the content type`)
      return {}
    }

    return {
      '200': {
        description: 'OK',
        headers: this.generateResponseHeaders(headerParams),
        content: {
          [contentType]: {
            schema: this.parseToSchema(
              bodyParams!,
              getDataTypeByContentType(responseContentType!)
            )
          }
        }
      }
    }
  }

  createBaseSchemaObject(param: BodyParam) {
    return {
      name: param?.name!,
      description: param?.description!,
      example: param?.paramAttr?.example!
    }
  }

  /**
   *
   * @param data
   * @param type data type
   * @returns
   */
  parseToSchema(
    data: RequestParams['bodyParams'],
    dataType: number,
    rest = {}
  ): OpenAPIV3.ArraySchemaObject | OpenAPIV3.NonArraySchemaObject {
    if (typeof data === 'string') {
      return {
        type: 'string',
        example: safeStringify(data)
      } as OpenAPIV3.SchemaObject
    } else {
      const schemaType = getDataType(dataType)
      if (schemaType === 'array') {
        return {
          ...this.createBaseSchemaObject(rest),
          type: schemaType,
          required: this.getRequired(data),
          items: this.parseToSchema(data, ApiParamsType.object)
        } as OpenAPIV3.ArraySchemaObject
      } else {
        type Properties = NonNullable<OpenAPIV3.BaseSchemaObject['properties']>
        return {
          ...this.createBaseSchemaObject(rest),
          type: schemaType as OpenAPIV3.NonArraySchemaObjectType,
          required: this.getRequired(data),
          properties: data?.reduce<Properties>((prev, curr) => {
            const { name, childList, isRequired, dataType, ...item } = curr!

            if (childList?.length) {
              prev[name!] = this.parseToSchema(childList, dataType!, {
                ...item,
                example: safeStringify(
                  item.paramAttr?.example || this.children2object(childList)
                )
              })
            } else {
              const type = getDataType(dataType!)

              prev[name!] = {
                ...this.createBaseSchemaObject(item),
                type: type as any,
                enum:
                  curr?.paramAttr?.paramValueList === undefined
                    ? undefined
                    : [].concat(safeJSONParse(curr?.paramAttr?.paramValueList)),
                items: dataType === ApiParamsType.array ? {} : undefined
              }
            }

            return prev
          }, {})
        }
      }
    }
  }

  children2object(children: BodyParam[] = [], initObj = {}) {
    return children.reduce((prev, curr) => {
      prev[curr.name!] = curr.paramAttr?.example
      if (curr.childList?.length) {
        prev[curr.name!] =
          getDataType(curr.dataType!) === 'object'
            ? this.children2object(curr.childList, (prev[curr.name!] = {}))
            : [this.children2object(curr.childList)]
      }
      return prev
    }, initObj)
  }

  generateResponseHeaders(
    headers: ResponseParams['headerParams'] = []
  ): OpenAPIV3.ResponseObject['headers'] {
    return headers?.reduce<Record<string, OpenAPIV3.HeaderObject>>(
      (prev, curr) => {
        prev[curr!.name!] = {
          description: curr!.description,
          required: Boolean(curr!.isRequired),
          example: curr?.paramAttr?.example
        }
        return prev
      },
      {}
    )
  }

  getRequired(data: RequestParams['bodyParams']) {
    const requireds = [
      ...new Set(
        data?.filter((it) => it?.isRequired).map((it) => it?.name) || []
      )
    ]
    return requireds.length ? requireds : undefined
  }

  generateTags(
    collections: ImportProjectDto['collections'] = [],
    arr: any[] = []
  ): OpenAPIV3.TagObject[] {
    return collections.reduce((prev, curr) => {
      if (curr?.collectionType === CollectionTypeEnum.GROUP) {
        prev.push({
          name: curr?.name!,
          description: curr?.name!
        })
        if ('children' in curr && curr.children?.length) {
          this.generateTags(curr.children, prev)
        }
      }
      return prev
    }, arr)
  }
}

export default PcToOpenAPI
