/**
 * radio5.cn 静态分类目录
 * 数据来源：https://radio5.cn/fm/radio-type （总枢纽页，分类稳定，硬编码不每次抓取）
 * path 是 radio5 上对应分类的 URL 子路径（不含域名），抓取时拼成 https://radio5.cn/{path}
 */
export interface CategoryOption {
  label: string
  path: string
}

export interface Catalog {
  quick: CategoryOption[]      // 5 个快捷标签（/fm/ 路径）
  level: CategoryOption[]      // 电台级别（/level/）
  area: CategoryOption[]       // 地区（/area/）
  type: CategoryOption[]       // 电台类型（/radio/）
  language: CategoryOption[]   // 主播语言（/language/）
}

export const radioCatalog: Catalog = {
  quick: [
    { label: '央媒', path: 'fm/cmg' },
    { label: '省台', path: 'fm/province' },
    { label: '港澳台', path: 'fm/hk' },
    { label: '热门城市台', path: 'fm/city' },
    { label: '市县台', path: 'fm/市县台' },
  ],
  level: [
    { label: '国家级', path: 'level/g' },
    { label: '省台', path: 'level/s' },
    { label: '市县台', path: 'level/x' },
    { label: '港澳台', path: 'level/hk' },
    { label: '热门城市台', path: 'level/c' },
    { label: '网络台', path: 'level/net' },
  ],
  area: [
    { label: '中央', path: 'area/cn' },
    { label: '北京', path: 'area/bj' },
    { label: '上海', path: 'area/sh' },
    { label: '天津', path: 'area/tj' },
    { label: '重庆', path: 'area/cq' },
    { label: '广东', path: 'area/gd' },
    { label: '江苏', path: 'area/js' },
    { label: '浙江', path: 'area/zj' },
    { label: '山东', path: 'area/sd' },
    { label: '河北', path: 'area/hb' },
    { label: '河南', path: 'area/hn' },
    { label: '辽宁', path: 'area/ln' },
    { label: '四川', path: 'area/sc' },
    { label: '福建', path: 'area/fj' },
    { label: '安徽', path: 'area/ah' },
    { label: '吉林', path: 'area/jl' },
    { label: '陕西', path: 'area/sx' },
    { label: '湖北', path: 'area/hubei' },
    { label: '山西', path: 'area/sxi' },
    { label: '湖南', path: 'area/hunan' },
    { label: '黑龙江', path: 'area/hlj' },
    { label: '江西', path: 'area/jx' },
    { label: '新疆', path: 'area/xj' },
    { label: '青海', path: 'area/qh' },
    { label: '广西', path: 'area/gx' },
    { label: '云南', path: 'area/yn' },
    { label: '贵州', path: 'area/gz' },
    { label: '宁夏', path: 'area/nx' },
    { label: '海南', path: 'area/hainan' },
    { label: '甘肃', path: 'area/gs' },
    { label: '西藏', path: 'area/xz' },
    { label: '内蒙古', path: 'area/nmg' },
    { label: '香港', path: 'area/hk' },
    { label: '澳门', path: 'area/macao' },
    { label: '台湾', path: 'area/tw' },
  ],
  type: [
    { label: '音乐', path: 'radio/music' },
    { label: '新闻综合', path: 'radio/news' },
    { label: '交通', path: 'radio/traffic' },
    { label: '生活', path: 'radio/life' },
    { label: '财经', path: 'radio/financial' },
    { label: '文艺|曲艺', path: 'radio/art' },
    { label: '都市', path: 'radio/city' },
    { label: '文体旅游', path: 'radio/cst' },
    { label: '乡村', path: 'radio/village' },
    { label: '青少科教', path: 'radio/youth' },
  ],
  language: [
    { label: '汉·普通话', path: 'language/cn' },
    { label: '汉·粤语', path: 'language/hk' },
    { label: '汉·方言|民族语', path: 'language/my' },
    { label: 'English', path: 'language/en' },
    { label: 'Bahasa Melayu', path: 'language/my-2' },
    { label: 'French', path: 'language/fr' },
    { label: 'Arabic', path: 'language/ar' },
    { label: 'Russian', path: 'language/ru' },
    { label: 'Spanish', path: 'language/es' },
    { label: 'Vietnamese', path: 'language/vn' },
    { label: 'German', path: 'language/de' },
    { label: 'Japanese', path: 'language/jp' },
    { label: 'Korean', path: 'language/kr' },
    { label: 'Italian', path: 'language/it' },
    { label: 'Portuguese', path: 'language/pt' },
  ],
}
