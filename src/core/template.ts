import { FrozenContext, PostAssignment, Station, StepTemplate } from './types';

/** 小瓶 → 大瓶 换型演练模板 */
export const STATIONS: Station[] = [
  { id: 'ST-MECH', name: '机械工位' },
  { id: 'ST-FILL', name: '灌装工位' },
  { id: 'ST-ELEC', name: '电控工位' },
  { id: 'ST-QC', name: '质检工位' },
];

export const TEMPLATE: StepTemplate[] = [
  { id: 'S1', name: '停机清场与旧料退出', stationId: 'ST-MECH', deps: [], kind: 'normal', requiresEvidence: false, estimatedMinutes: 15, description: '停线、排空小瓶产品、清场确认' },
  { id: 'S2', name: '更换输送导轨(大瓶规格)', stationId: 'ST-MECH', deps: ['S1'], kind: 'normal', requiresEvidence: true, estimatedMinutes: 40, description: '更换宽轨并按扭矩表紧固,拍照留证' },
  { id: 'S3', name: '更换灌装头与量杯', stationId: 'ST-FILL', deps: ['S1'], kind: 'normal', requiresEvidence: true, estimatedMinutes: 30, description: '换装 500ml 灌装头与量杯' },
  { id: 'S4', name: '设定灌装参数', stationId: 'ST-ELEC', deps: ['S3'], kind: 'normal', requiresEvidence: true, estimatedMinutes: 20, description: '灌装量、速度、回吸参数录入并双人核对' },
  { id: 'S5', name: '更新视觉检测配方', stationId: 'ST-QC', deps: ['S1'], kind: 'normal', requiresEvidence: true, estimatedMinutes: 25, description: '切换大瓶检测配方,验证模板匹配' },
  { id: 'S6', name: '空载联动试运行', stationId: 'ST-MECH', deps: ['S2', 'S4'], kind: 'normal', requiresEvidence: false, estimatedMinutes: 20, description: '机械与参数联动空跑确认' },
  { id: 'S7', name: '首件检验', stationId: 'ST-QC', deps: ['S5', 'S6'], kind: 'checkpoint', requiresEvidence: true, estimatedMinutes: 30, description: '首件全项检验,作为批次检查点' },
  { id: 'S8', name: '灌装精度复测', stationId: 'ST-FILL', deps: ['S7'], kind: 'normal', requiresEvidence: true, estimatedMinutes: 20, description: '连续抽样复测灌装精度' },
  { id: 'S9', name: '视觉检测验证', stationId: 'ST-QC', deps: ['S7'], kind: 'normal', requiresEvidence: true, estimatedMinutes: 20, description: '缺陷样本挑战验证' },
  { id: 'S10', name: '换型放行签收', stationId: 'ST-ELEC', deps: ['S8', 'S9'], kind: 'checkpoint', requiresEvidence: false, estimatedMinutes: 10, description: '质量与生产双签收,具备放行条件' },
];

export const DEFAULT_POSTS: PostAssignment[] = [
  { postId: 'P-CAPT', postName: '机长', operator: '王机长' },
  { postId: 'P-MECH', postName: '机械员', operator: '李机械' },
  { postId: 'P-ELEC', postName: '电控员', operator: '赵电控' },
  { postId: 'P-QC', postName: '质检员', operator: '陈质检' },
];

export const DEFAULT_FROZEN: Omit<FrozenContext, 'frozenAt'> = {
  productVersion: '大瓶 500ml / BOM v3.2(由小瓶 100ml 切换)',
  equipmentConfig: '宽导轨 G-500;灌装头 F-500×8;旋盖模 M-500',
  inspectionStandard: '首件检验 SIP-500 v2.1;视觉配方 VR-500-07',
  posts: DEFAULT_POSTS,
};
