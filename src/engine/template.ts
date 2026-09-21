import type { ChangeoverTemplate } from './types'

/**
 * 演练场景：包装产线 250ml 小瓶 → 1000ml 大瓶换型
 * 需更换导轨、调整灌装参数、切换视觉检测配方。
 * s20/s22 与 s40/s44 分别共用互锁工位，清场后并行展开，
 * 可演示“工位互锁：同一时刻只允许一个步骤在执行”。
 */
export const TEMPLATE_SMALL_TO_LARGE: ChangeoverTemplate = {
  id: 'tpl-b250-to-b1000',
  name: '包装产线换型：250ml 小瓶 → 1000ml 大瓶',
  stations: [
    { id: 'st-prep', name: '清场备料工位' },
    { id: 'st-guide', name: '导轨工位', exclusive: true },
    { id: 'st-fill', name: '灌装工位', exclusive: true },
    { id: 'st-vision', name: '视觉检测工位', exclusive: true },
    { id: 'st-qc', name: '质检放行工位' },
  ],
  steps: [
    {
      id: 's10',
      code: 'S10',
      title: '清场并移除上批小瓶物料',
      stationId: 'st-prep',
      role: '清场员',
      prereq: [],
      durationMin: 10,
      evidenceKinds: [
        { id: 'ev-line-clear', label: '清场检查表', required: true },
        { id: 'ev-label-destroy', label: '上批标签销毁照片' },
      ],
    },
    {
      id: 's20',
      code: 'S20',
      title: '更换大瓶导轨组件并紧固',
      stationId: 'st-guide',
      role: '导轨技师',
      prereq: ['s10'],
      durationMin: 25,
      evidenceKinds: [
        { id: 'ev-guide-model', label: '导轨型号 G-1000 确认', required: true },
        { id: 'ev-torque', label: '紧固扭矩记录', required: true },
      ],
    },
    {
      id: 's22',
      code: 'S22',
      title: '调节护栏宽度并安装大瓶护罩',
      stationId: 'st-guide',
      role: '导轨技师',
      prereq: ['s10'],
      durationMin: 15,
      evidenceKinds: [{ id: 'ev-guard-width', label: '护栏宽度 90mm 实测', required: true }],
    },
    {
      id: 's30',
      code: 'S30',
      title: '调整灌装参数至大瓶配方',
      stationId: 'st-fill',
      role: '灌装技师',
      prereq: ['s20', 's22'],
      durationMin: 20,
      evidenceKinds: [
        { id: 'ev-fill-volume', label: '首件灌装量记录', required: true, async: true },
        { id: 'ev-panel-photo', label: '参数面板照片' },
      ],
      parameter: {
        name: '灌装量设定',
        values: ['1000ml（大瓶目标值）', '500ml（中间值）', '250ml（小瓶旧值）'],
      },
    },
    {
      id: 's40',
      code: 'S40',
      title: '切换视觉检测配方 VIS-1000',
      stationId: 'st-vision',
      role: '视觉工程师',
      prereq: ['s10'],
      durationMin: 20,
      evidenceKinds: [
        { id: 'ev-recipe-ver', label: '配方版本 VIS-1000 确认', required: true },
        { id: 'ev-trial-shot', label: '试拍样本回执', required: true, async: true },
      ],
    },
    {
      id: 's44',
      code: 'S44',
      title: '视觉光源与相机焦距标定',
      stationId: 'st-vision',
      role: '视觉工程师',
      prereq: ['s10'],
      durationMin: 15,
      evidenceKinds: [{ id: 'ev-focus-cal', label: '焦距标定值记录', required: true }],
    },
    {
      id: 's50',
      code: 'S50',
      title: '试生产首件检验',
      stationId: 'st-qc',
      role: 'QC',
      prereq: ['s30', 's40', 's44'],
      durationMin: 30,
      evidenceKinds: [
        { id: 'ev-dim-report', label: '首件尺寸报告', required: true, async: true },
        { id: 'ev-appearance', label: '外观检查记录', required: true },
      ],
    },
    {
      id: 's60',
      code: 'S60',
      title: '整线联动试运行',
      stationId: 'st-qc',
      role: 'QC',
      prereq: ['s50'],
      durationMin: 30,
      evidenceKinds: [{ id: 'ev-trial-run', label: '联动运行 30 分钟记录', required: true }],
    },
    {
      id: 's70',
      code: 'S70',
      title: '质量签收并放行',
      stationId: 'st-qc',
      role: '班组长',
      prereq: ['s60'],
      critical: true,
      durationMin: 10,
      evidenceKinds: [{ id: 'ev-release', label: '放行签收单', required: true }],
    },
  ],
  frozen: {
    line: '1# 包装产线',
    productFrom: { sku: 'B-250', name: '250ml 圆瓶（小瓶）', spec: 'φ60×120mm' },
    productTo: { sku: 'B-1000', name: '1000ml 大瓶', spec: 'φ90×230mm' },
    equipmentConfig: [
      { name: '导轨组件', value: 'G-250 → G-1000' },
      { name: '护栏/护罩', value: '宽 60mm → 90mm，大瓶护罩' },
      { name: '灌装头', value: 'H-STD（量程已复核）' },
      { name: '旋盖头', value: 'C-L 大瓶模块' },
      { name: '视觉配方', value: 'VIS-250 → VIS-1000' },
    ],
    posts: [
      { role: '清场员', stationId: 'st-prep', operator: '张磊（夜班）' },
      { role: '导轨技师', stationId: 'st-guide', operator: '李建国' },
      { role: '灌装技师', stationId: 'st-fill', operator: '王海涛' },
      { role: '视觉工程师', stationId: 'st-vision', operator: '陈曦' },
      { role: 'QC', stationId: 'st-qc', operator: '赵颖' },
      { role: '班组长', stationId: 'st-qc', operator: '刘芳' },
    ],
    standards: [
      { id: 'STD-GUIDE-04', title: '导轨更换与扭矩作业标准', version: 'V4.2' },
      { id: 'STD-FILL-11', title: '灌装参数切换与首件确认标准', version: 'V3.0' },
      { id: 'STD-VIS-07', title: '视觉配方验证标准', version: 'V2.5' },
      { id: 'STD-REL-02', title: '换型放行管理标准', version: 'V5.1' },
    ],
  },
}

export const TEMPLATES: ChangeoverTemplate[] = [TEMPLATE_SMALL_TO_LARGE]

export function getTemplate(id: string): ChangeoverTemplate {
  const t = TEMPLATES.find((x) => x.id === id)
  if (!t) throw new Error(`未知模板：${id}`)
  return t
}
