import { YApiImporter } from './YApiImporter'

export const importFunc = (data) => {
  console.log('YApi before PostmanImport', data)
  // yapi的json数据是数组,且没有api（即没有list）的分组不会被导出
  if (!data || !data?.[0]?.name || !data?.[0]?.list) {
    return [null, { msg: '文件不合法,该文件不是 YApi 格式' }]
  }
  const yapiImporter = new YApiImporter(data)
  console.log('YApi after PostmanImport', yapiImporter.pikaData)
  return [yapiImporter.pikaData, null]
}
