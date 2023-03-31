import { isString, uniqueSlash, getDataType } from './utils'

import {
  CollectionTypeEnum,
  ImportProjectDto
} from '../../../shared/src/types/pcAPI'
import type {
  Items,
  HeaderList,
  Request1 as Request,
  Url,
  Response,
  Header,
  HttpsSchemaGetpostManComJsonDraft07CollectionV210,
  VariableList
} from './types/postman-collection'
import { text2table } from '../../../shared/src/utils/data-transfer'
import {
  whatTextType,
  safeStringify,
  safeJSONParse
} from '../../../shared/src/utils/common'
import { Group } from '../../../shared/src/types/group'
import {
  ApiData,
  BodyParam,
  HeaderParam,
  RequestParams,
  ResponseParams
} from '../../../shared/src/types/apiData'
import {
  ApiParamsType,
  ContentType,
  mui,
  Protocol,
  RequestMethod
} from '../../../shared/src/types/api.model'

export class PostmanImporter {
  pikaData: ImportProjectDto
  postmanData: HttpsSchemaGetpostManComJsonDraft07CollectionV210

  constructor(data: HttpsSchemaGetpostManComJsonDraft07CollectionV210) {
    this.postmanData = data
    this.pikaData = this.transformToPika(data)
  }

  transformToPika(
    data: HttpsSchemaGetpostManComJsonDraft07CollectionV210
  ): ImportProjectDto {
    return {
      collections: this.transformItems([
        {
          name: data.info?.name || 'Import postman collection',
          item: data.item
        }
      ]),
      environmentList: this.transformEnv(data.variable)
    }
  }

  transformItems(items: Items[]): ImportProjectDto['collections'] {
    return items.map((item) => {
      if (!item.request) {
        return {
          name: item.name,
          collectionType: CollectionTypeEnum.GROUP,
          children:
            Array.isArray(item.item) && item.item.length
              ? this.transformItems(item.item)
              : []
        } as Group
      }
      const request = item.request as Request
      const response = item.response as Response[]
      return {
        collectionType: CollectionTypeEnum.API_DATA,
        name: item.name,
        uri: this.handleUrl(request?.url) || item.name,
        protocol: Protocol.HTTP,
        apiAttrInfo: {
          requestMethod: RequestMethod[request?.method?.toUpperCase() || 'GET'],
          contentType: this.handleRequestBodyType(request?.body)
        },
        requestParams: {
          headerParams: this.handleRequestHeader(request?.header),
          queryParams: this.handleQueryParams(request?.url),
          restParams: [],
          bodyParams: this.handleRequestBody(request?.body)
        },
        responseList: [
          {
            isDefault: 1,
            contentType: this.handleResponseBodyType(response),
            responseParams: {
              headerParams: this.handleResponseHeaders(response),
              bodyParams: this.handleResponseBody(response)
            }
          }
        ]
      } as ApiData
    })
  }

  transformEnv(
    postmanEnv: VariableList = []
  ): ImportProjectDto['environmentList'] {
    return [
      {
        name: 'postImport',
        hostUri: 'http://localhost',
        parameters: JSON.stringify(
          postmanEnv.map((item) => ({
            // rome-ignore lint/style/noNonNullAssertion: <explanation>
            name: item.key!,
            value: item.value as unknown as string
          }))
        )
      }
    ]
  }

  handleUrl(url: Url = ''): string {
    if (isString(url)) {
      return url
    } else {
      const newUri = this.postmanData.variable?.reduce((prev, curr) => {
        return prev?.replace(`{{${curr.key}}}`, safeStringify(curr.value || ''))
      }, url?.raw)
      return uniqueSlash(newUri || url?.raw || '')
    }
  }

  handleQueryParams(url: Url = ''): RequestParams['queryParams'] {
    if (isString(url)) {
      return []
    } else {
      return (
        url.query?.map((n) => ({
          name: n.key || '',
          partType: mui.queryParams,
          dataType: ApiParamsType[typeof n.value],
          isRequired: 1,
          description: n.description as string,
          paramAttr: {
            example: n.value || ''
          }
        })) || []
      )
    }
  }

  handleRequestHeader(headerList: HeaderList | string = []): HeaderParam[] {
    if (isString(headerList)) {
      return []
    } else {
      return (
        headerList.map((n) => ({
          name: n.key,
          partType: mui.headerParams,
          isRequired: 1,
          description: n.description as string,
          paramAttr: {
            example: n.value
          }
        })) || []
      )
    }
  }

  handleRequestBodyType(body: Request['body']): ContentType {
    switch (body?.mode) {
      case 'raw':
        const type = whatTextType(body.raw)
        if (type === 'xml') {
          return ContentType.XML
        } else if (type === 'json') {
          return Array.isArray(safeJSONParse(body.raw))
            ? ContentType.JSON_ARRAY
            : ContentType.JSON_OBJECT
        } else {
          return ContentType.RAW
        }
      case 'file':
        return ContentType.BINARY
      case 'formdata':
        return ContentType.FROM_DATA
      case 'urlencoded':
        return ContentType.FROM_DATA
      default:
        return ContentType.JSON_OBJECT
    }
  }

  handleResponseBodyType(res: Response[] = []): ContentType {
    return this.handleRequestBodyType(res[0]?.body as Request['body'])
  }

  handleRequestBody(body: Request['body']): RequestParams['bodyParams'] {
    if (Object.is(body, null)) {
      return []
    } else if (body?.mode === 'raw') {
      try {
        if (whatTextType(body.raw) === 'json') {
          return this.transformBodyData(JSON.parse(body.raw.replace(/\s/g, '')))
        }
        return text2table(body.raw || '').data
      } catch (error) {
        console.error(error)
        return [
          {
            name: '',
            isRequired: 1,
            binaryRawData: body.raw || '',
            paramAttr: {}
          }
        ]
      }
      // rome-ignore lint/style/noNonNullAssertion: <explanation>
    } else if (['formdata', 'urlencoded'].includes(body?.mode!)) {
      // rome-ignore lint/style/noNonNullAssertion: <explanation>
      const data = body?.[body.mode!] as NonNullable<
        Request['body']
      >['formdata']
      return (
        data?.map((n) => ({
          dataType:
            n.type === 'file' ? ApiParamsType.file : ApiParamsType.string,
          name: n.key,
          partType: mui.bodyParams,
          isRequired: n.disabled ? 0 : 1,
          description: n.description as string,
          paramAttr: {
            example: n.value as string
          }
        })) || []
      )
    }
    return []
  }

  handleResponseBody(res: Response[] = []): ResponseParams['bodyParams'] {
    try {
      // rome-ignore lint/style/noNonNullAssertion: <explanation>
      const result = JSON.parse(res[0].body?.replace(/\s/g, '')!)
      return [].concat(result).flatMap((item) => {
        return Object.entries(item).map<BodyParam>(([key, value]) => ({
          description: '',
          name: key,
          isRequired: 1,
          dataType: ApiParamsType[getDataType(value)],
          paramAttr: {
            example: safeStringify(value)
          },
          childList:
            value && typeof value === 'object'
              ? this.transformBodyData(value)
              : undefined
        }))
      })
    } catch (error) {
      return res[0]?.body
        ? [
            {
              name: '',
              isRequired: 1,
              binaryRawData: res[0]?.body,
              paramAttr: {}
            }
          ]
        : []
    }
  }

  transformBodyData(val: Record<string, any>[]): BodyParam[] {
    return Array()
      .concat(val)
      .flatMap((n) => {
        if (typeof n !== 'object') {
          return []
        }
        return Object.entries<any>(n).map<BodyParam>(([key, value], index) => {
          return {
            description: '',
            name: key,
            isRequired: 1,
            orderNo: index,
            dataType: ApiParamsType[getDataType(value)],
            paramAttr: {
              example: safeStringify(value)
            },
            childList:
              value && typeof value === 'object'
                ? this.transformBodyData(value)
                : undefined
          }
        })
      })
  }

  handleResponseHeaders(res: Response[] = []): HeaderParam[] {
    if (Array.isArray(res[0]?.header)) {
      return res[0].header
        .filter((n): n is Header => !isString(n))
        .map((n) => ({
          name: n.key,
          isRequired: 0,
          paramAttr: {
            example: n.value
          },
          description: n.description as string
        }))
    } else {
      return []
    }
  }

  handleJsonRootType(body: Request['body']): ContentType {
    let _body = body?.raw

    if (isString(_body)) {
      try {
        _body = JSON.parse(_body.replace(/\s/g, ''))
      } catch (error) {}
    }

    if (Array.isArray(_body)) {
      return ContentType.JSON_ARRAY
    } else {
      return ContentType.JSON_OBJECT
    }
  }
}
