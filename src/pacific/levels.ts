/**
 * The ten levels, in the order the Pacific War was fought: Pearl Harbor (Dec 1941) to Okinawa and
 * the last sortie of the Yamato (Apr 1945). Each one names its battle, date and place, carries a
 * short historical briefing in Vietnamese, the look of its sea and sky, the enemies its waves are
 * drawn from, the formations and set pieces, the scenery, and the boss.
 *
 * The briefings stick to the record (dates, ships, aircraft, numbers); what happens in the game is
 * of course an arcade dramatisation.
 */
import type { BossKind, DecorKind, EnemyKind } from './types';

export type FormationKind =
  | 'vee' | 'column' | 'wall' | 'crossing' | 'behind' | 'loops' | 'bombers' | 'heavy' | 'divers'
  | 'swarm' | 'ohka' | 'convoy' | 'cruiser' | 'barges' | 'aaSite';

export interface LevelEnv {
  /** Short label of the light (shown on the briefing card). */
  light: string;
  /** Direction towards the sun / moon (world: x east, y up, z towards the camera). */
  sun: [number, number, number];
  sunColor: number;
  sunIntensity: number;
  skyColor: number;
  groundColor: number;
  hemiIntensity: number;
  fogColor: number;
  /** Fog density (exp²), per world unit. */
  fog: number;
  seaDeep: number;
  seaShallow: number;
  /** Strength of the sun glint on the water. */
  glint: number;
  /** Cloud cover below / above the aircraft, 0–1. */
  cloudsLow: number;
  cloudsHigh: number;
  cloudColor: number;
  /** Rain streaks, 0–1. */
  rain: number;
  /** Tone-mapping exposure. */
  exposure: number;
}

export interface SetPiece {
  t: number;
  formation: FormationKind;
  kind?: EnemyKind;
  n?: number;
  x?: number;
}

export interface LevelDef {
  index: number;
  key: string;
  title: string;
  place: string;
  date: string;
  /** Year as a number, for ordering and the HUD. */
  year: number;
  /** Month (1–12) of the battle's key day, for ordering. */
  month: number;
  brief: string;
  objective: string;
  /** Field guide line shown under the briefing ("Bạn có biết?"). */
  fact: string;
  env: LevelEnv;
  /** Seconds of waves before the boss. */
  duration: number;
  /** Mean seconds between waves at the start; it tightens towards the end. */
  gap: number;
  roster: { fighter: EnemyKind[]; bomber: EnemyKind[]; diver: EnemyKind[]; suicide: EnemyKind[] };
  formations: Partial<Record<FormationKind, number>>;
  setPieces: SetPiece[];
  scenery: { every: number; kinds: DecorKind[]; specials: { at: number; kind: DecorKind; x: number; scale: number; rot?: number }[] };
  boss: BossKind;
  bossIntel: string;
  seed: number;
}

const DAY: LevelEnv = {
  light: 'Ban ngày', sun: [0.45, 0.85, 0.3], sunColor: 0xfff1d6, sunIntensity: 2.6, skyColor: 0xbcd8ff, groundColor: 0x2a4a5a,
  hemiIntensity: 1.1, fogColor: 0x9fc4dc, fog: 0.0042, seaDeep: 0x0b3d63, seaShallow: 0x1f7f9a, glint: 1, cloudsLow: 0.45,
  cloudsHigh: 0.3, cloudColor: 0xffffff, rain: 0, exposure: 1,
};

export const LEVELS: LevelDef[] = [
  {
    index: 0, key: 'pearl', title: 'Trân Châu Cảng', place: 'Oahu, Hawaii', date: '7/12/1941', year: 1941, month: 12,
    brief: 'Sáng Chủ nhật 7/12/1941, 353 máy bay cất cánh từ sáu tàu sân bay của Hạm đội Cơ động Kidō Butai tấn công bất ngờ căn cứ Hạm đội Thái Bình Dương. Dãy Thiết giáp hạm bốc cháy; chỉ vài phi công Mỹ như George Welch và Kenneth Taylor kịp cất cánh đánh trả.',
    objective: 'Cất cánh từ đảo Oahu, chặn đợt tấn công thứ hai trên bầu trời Trân Châu Cảng.',
    fact: 'Trung tá Fuchida Mitsuo chỉ huy toàn bộ cuộc không kích từ một chiếc B5N "Kate"; mật lệnh "Tora! Tora! Tora!" báo rằng cuộc tấn công đã bất ngờ.',
    env: { ...DAY, light: 'Bình minh', sun: [0.85, 0.42, -0.1], sunColor: 0xffc890, sunIntensity: 2.2, skyColor: 0xf3c9a4, fogColor: 0xd9b8a0, fog: 0.0048, seaDeep: 0x0d3a5a, seaShallow: 0x2a8a96, glint: 1.4, cloudsLow: 0.35, cloudsHigh: 0.25, cloudColor: 0xffe4cc, exposure: 0.95 },
    duration: 75, gap: 3.4,
    roster: { fighter: ['zero'], bomber: ['kate'], diver: ['val'], suicide: [] },
    formations: { vee: 3, column: 3, crossing: 2, loops: 2, divers: 2, bombers: 1, behind: 1 },
    setPieces: [{ t: 22, formation: 'divers', kind: 'val', n: 4 }, { t: 48, formation: 'bombers', kind: 'kate', n: 3 }],
    scenery: {
      every: 70, kinds: ['reef', 'island'],
      specials: [{ at: 20, kind: 'coast', x: -27, scale: 1.2 }, { at: 150, kind: 'fordIsland', x: 3, scale: 1 }, { at: 150, kind: 'battleshipRow', x: 11, scale: 1 }, { at: 330, kind: 'coast', x: 27, scale: 1, rot: Math.PI }],
    },
    boss: 'fuchida', bossIntel: 'Tốp B5N chỉ huy cùng bốn Zero hộ tống bay vòng quanh. Hạ hộ tống trước để được thêm điểm.',
    seed: 1207,
  },
  {
    index: 1, key: 'wake', title: 'Đảo Wake', place: 'Đảo san hô Wake, Trung Thái Bình Dương', date: '11/12/1941', year: 1941, month: 12,
    brief: 'Chỉ vài giờ sau Trân Châu Cảng, máy bay ném bom Nhật tấn công đảo san hô Wake. Ngày 11/12/1941, lực lượng phòng thủ Thủy quân Lục chiến Mỹ đẩy lùi cuộc đổ bộ đầu tiên: pháo bờ biển bắn chìm khu trục hạm Hayate, các chiến đấu cơ F4F Wildcat ném bom đánh chìm khu trục hạm Kisaragi.',
    objective: 'Ngăn hạm đội đổ bộ của Chuẩn Đô đốc Kajioka tiếp cận đảo Wake.',
    fact: 'Ngày 11/12/1941 là một trong rất ít lần trong Thế chiến II một cuộc đổ bộ bị bên phòng thủ đẩy lùi. Nhật quay lại với lực lượng lớn hơn; đảo thất thủ ngày 23/12/1941.',
    env: { ...DAY, sun: [0.3, 0.9, 0.3], seaDeep: 0x083a6e, seaShallow: 0x23a3b4, cloudsLow: 0.3, cloudsHigh: 0.2 },
    duration: 80, gap: 3.2,
    roster: { fighter: ['zero'], bomber: ['kate'], diver: ['val'], suicide: [] },
    formations: { vee: 3, column: 3, crossing: 2, loops: 2, divers: 2, bombers: 1, behind: 1, convoy: 2, barges: 1 },
    setPieces: [{ t: 30, formation: 'convoy', kind: 'destroyer', n: 2 }, { t: 58, formation: 'barges', n: 4 }],
    scenery: { every: 80, kinds: ['reef', 'atoll'], specials: [{ at: 30, kind: 'wakeAtoll', x: -6, scale: 1 }] },
    boss: 'yubari', bossIntel: 'Kỳ hạm Yūbari: bốn tháp pháo chính, hai ụ phòng không và đài chỉ huy bắn tỏa tròn.',
    seed: 1211,
  },
  {
    index: 2, key: 'coral', title: 'Biển San Hô', place: 'Biển San Hô, đông bắc Úc', date: '7/5/1942', year: 1942, month: 5,
    brief: 'Trận hải chiến đầu tiên trong lịch sử mà hai hạm đội không hề nhìn thấy nhau: mọi đòn đánh đều do máy bay từ tàu sân bay thực hiện. Ngày 7/5/1942, máy bay từ Lexington và Yorktown đánh chìm tàu sân bay hạng nhẹ Shōhō, chặn đường Nhật đánh chiếm Port Moresby.',
    objective: 'Tìm và đánh chìm tàu sân bay hạng nhẹ Shōhō đang yểm trợ đoàn đổ bộ.',
    fact: '"Scratch one flat-top!" (Gạch tên một tàu sân bay!) — bức điện của Thiếu tá Robert Dixon sau khi Shōhō bị đánh chìm.',
    env: { ...DAY, sun: [-0.4, 0.82, 0.4], seaDeep: 0x07335c, seaShallow: 0x1a8bb0, cloudsLow: 0.55, cloudsHigh: 0.35 },
    duration: 85, gap: 3,
    roster: { fighter: ['zero'], bomber: ['kate'], diver: ['val'], suicide: [] },
    formations: { vee: 3, column: 3, wall: 1, crossing: 2, loops: 2, divers: 2, bombers: 2, behind: 1, convoy: 1 },
    setPieces: [{ t: 40, formation: 'convoy', kind: 'destroyer', n: 3 }],
    scenery: { every: 95, kinds: ['reef', 'reef', 'island'], specials: [{ at: 380, kind: 'burningCarrier', x: -18, scale: 1 }] },
    boss: 'shoho', bossIntel: 'Shōhō phóng Zero và Val từ sàn bay. Phá sàn bay để chặn máy bay cất cánh.',
    seed: 1942_05,
  },
  {
    index: 3, key: 'midway', title: 'Midway', place: 'Quần đảo Midway', date: '4/6/1942', year: 1942, month: 6,
    brief: 'Nhờ giải mã mật mã hải quân JN-25, Mỹ biết trước kế hoạch của Đô đốc Yamamoto. Sáng 4/6/1942, trong khoảng sáu phút, máy bay ném bom bổ nhào SBD Dauntless biến ba tàu sân bay Akagi, Kaga và Sōryū thành biển lửa; Hiryū bị đánh chìm chiều cùng ngày. Bước ngoặt của chiến tranh Thái Bình Dương.',
    objective: 'Vượt màn hỏa lực của Hạm đội Cơ động, tấn công kỳ hạm Akagi.',
    fact: 'Nhật mất bốn tàu sân bay hạm đội và hơn 3.000 người; Mỹ mất tàu sân bay Yorktown. Từ đây thế chủ động chuyển sang phía Mỹ.',
    env: { ...DAY, light: 'Buổi sáng', sun: [0.6, 0.7, 0.2], seaDeep: 0x0a3a66, seaShallow: 0x2194b0, cloudsLow: 0.6, cloudsHigh: 0.4 },
    duration: 90, gap: 2.9,
    roster: { fighter: ['zero'], bomber: ['kate'], diver: ['val'], suicide: [] },
    formations: { vee: 3, column: 3, wall: 2, crossing: 2, loops: 2, divers: 2, bombers: 2, behind: 1, convoy: 2, cruiser: 1 },
    setPieces: [{ t: 35, formation: 'cruiser', kind: 'cruiser', n: 1 }, { t: 62, formation: 'wall', kind: 'zero', n: 6 }],
    scenery: { every: 110, kinds: ['reef'], specials: [{ at: 15, kind: 'midwayAtoll', x: 12, scale: 1 }, { at: 420, kind: 'burningCarrier', x: 16, scale: 1 }, { at: 560, kind: 'burningCarrier', x: -20, scale: 1, rot: 0.4 }] },
    boss: 'akagi', bossIntel: 'Akagi có hai sàn phóng máy bay, đài chỉ huy bên mạn trái và bốn ụ phòng không.',
    seed: 1942_06,
  },
  {
    index: 4, key: 'guadalcanal', title: 'Guadalcanal', place: 'Eo biển Đáy Sắt, quần đảo Solomon', date: '13/11/1942', year: 1942, month: 11,
    brief: 'Suốt nửa năm, "Tốc hành Tokyo" chở quân tiếp viện ra Guadalcanal trong đêm. Rạng sáng 13/11/1942, thiết giáp hạm Hiei bị trúng hàng chục phát đạn trong trận đánh đêm, rồi bị máy bay từ sân bay Henderson và tàu sân bay Enterprise tấn công suốt ngày; tối hôm đó Hiei bị đánh đắm gần đảo Savo.',
    objective: 'Đánh chặn đoàn tàu "Tốc hành Tokyo" trong đêm, hạ thiết giáp hạm Hiei.',
    fact: 'Vùng biển quanh đảo Savo có nhiều xác tàu chìm đến mức được gọi là "Eo biển Đáy Sắt" (Ironbottom Sound).',
    env: {
      ...DAY, light: 'Đêm trăng', sun: [-0.35, 0.75, -0.55], sunColor: 0x9fb6ff, sunIntensity: 1.1, skyColor: 0x223a66, groundColor: 0x05080f,
      hemiIntensity: 0.55, fogColor: 0x0b1424, fog: 0.0055, seaDeep: 0x020a16, seaShallow: 0x0c2a3a, glint: 0.35, cloudsLow: 0.35, cloudsHigh: 0.25, cloudColor: 0x5a6a8c, exposure: 1.25,
    },
    duration: 90, gap: 2.8,
    roster: { fighter: ['zero'], bomber: ['betty'], diver: ['val'], suicide: [] },
    formations: { vee: 3, column: 3, crossing: 2, loops: 2, divers: 1, heavy: 1, behind: 1, convoy: 3, barges: 2 },
    setPieces: [{ t: 25, formation: 'convoy', kind: 'destroyer', n: 3 }, { t: 55, formation: 'cruiser', kind: 'cruiser', n: 1 }],
    scenery: { every: 100, kinds: ['jungle', 'reef', 'wreck'], specials: [{ at: 10, kind: 'coast', x: -27, scale: 1 }, { at: 300, kind: 'savo', x: 14, scale: 1 }] },
    boss: 'hiei', bossIntel: 'Hiei mang bốn tháp pháo đôi 356 mm (đạn hồng lớn) và đài chỉ huy bắn xoắn ốc khi bị dồn ép.',
    seed: 1942_11,
  },
  {
    index: 5, key: 'vengeance', title: 'Chiến dịch Vengeance', place: 'Bougainville, quần đảo Solomon', date: '18/4/1943', year: 1943, month: 4,
    brief: 'Tình báo Mỹ giải mã lịch trình thị sát tiền tuyến của Đô đốc Yamamoto Isoroku, tổng tư lệnh Hạm đội Liên hợp. 16 chiếc P-38 Lightning từ Guadalcanal bay khoảng 700 km sát mặt sóng để đánh chặn; chiếc G4M chở Yamamoto bị bắn rơi xuống rừng rậm Bougainville.',
    objective: 'Bay thấp dọc quần đảo Solomon, đánh chặn chiếc G4M số hiệu T1-323 và sáu Zero hộ tống.',
    fact: 'Đây là phi vụ đánh chặn tầm xa nhất của chiến tranh khi đó; P-38 phải mang thùng dầu phụ và giữ im lặng vô tuyến suốt chặng bay.',
    env: { ...DAY, light: 'Sáng nhiệt đới', sun: [0.2, 0.93, 0.3], sunColor: 0xfff6e0, fogColor: 0xb6d4c8, fog: 0.005, seaDeep: 0x0a4058, seaShallow: 0x2aa49a, cloudsLow: 0.5, cloudsHigh: 0.35 },
    duration: 85, gap: 2.8,
    roster: { fighter: ['zero', 'oscar'], bomber: ['betty'], diver: ['val'], suicide: [] },
    formations: { vee: 3, column: 3, wall: 1, crossing: 2, loops: 2, divers: 1, heavy: 2, behind: 2, barges: 1 },
    setPieces: [{ t: 30, formation: 'heavy', kind: 'betty', n: 2 }, { t: 60, formation: 'behind', kind: 'zero', n: 4 }],
    scenery: { every: 60, kinds: ['jungle', 'jungle', 'island', 'reef'], specials: [{ at: 10, kind: 'coast', x: 27, scale: 1, rot: Math.PI }, { at: 400, kind: 'coast', x: -27, scale: 1.2 }] },
    boss: 'yamamoto', bossIntel: 'Chiếc G4M có ụ súng đuôi và ụ súng lưng, sáu Zero hộ tống bay vòng quanh.',
    seed: 1943_04,
  },
  {
    index: 6, key: 'philippineSea', title: 'Biển Philippines', place: 'Phía tây quần đảo Mariana', date: '19/6/1944', year: 1944, month: 6,
    brief: '"Cuộc săn gà tây vĩ đại ở Mariana": ngày 19/6/1944, phi công F6F Hellcat của Lực lượng Đặc nhiệm 58 bắn rơi hàng trăm máy bay Nhật trong bốn đợt tấn công. Hôm sau tàu sân bay Hiyō bị máy bay phóng ngư lôi đánh chìm. Không lực hải quân Nhật không bao giờ hồi phục.',
    objective: 'Đánh tan bốn đợt không kích nhắm vào hạm đội Mỹ.',
    fact: 'Radar và hệ thống chỉ huy đánh chặn giúp Hellcat chờ sẵn ở độ cao thuận lợi; phi công Nhật khi đó phần lớn mới chỉ có vài tháng huấn luyện.',
    env: { ...DAY, light: 'Giữa trưa', sun: [0.15, 0.97, 0.2], sunColor: 0xffffff, sunIntensity: 2.9, seaDeep: 0x062c5e, seaShallow: 0x1677a8, cloudsLow: 0.65, cloudsHigh: 0.45 },
    duration: 95, gap: 2.4,
    roster: { fighter: ['zero', 'george'], bomber: ['kate', 'betty'], diver: ['val'], suicide: [] },
    formations: { vee: 4, column: 3, wall: 2, crossing: 2, loops: 2, divers: 2, bombers: 2, heavy: 1, behind: 1 },
    setPieces: [{ t: 20, formation: 'wall', kind: 'zero', n: 7 }, { t: 45, formation: 'heavy', kind: 'betty', n: 3 }, { t: 70, formation: 'wall', kind: 'george', n: 6 }],
    scenery: { every: 140, kinds: ['reef'], specials: [{ at: 60, kind: 'usCarrier', x: -16, scale: 1 }, { at: 260, kind: 'usCarrier', x: 18, scale: 1, rot: 0.2 }] },
    boss: 'emily', bossIntel: 'Thủy phi cơ bốn động cơ H8K: hạ từng động cơ để giảm hỏa lực, coi chừng ụ súng mũi và đuôi.',
    seed: 1944_06,
  },
  {
    index: 7, key: 'leyte', title: 'Vịnh Leyte', place: 'Biển Sibuyan, Philippines', date: '24/10/1944', year: 1944, month: 10,
    brief: 'Trận hải chiến lớn nhất lịch sử. Ngày 24/10/1944 trên biển Sibuyan, siêu thiết giáp hạm Musashi trúng khoảng 19 ngư lôi và 17 quả bom từ máy bay trên tàu sân bay Mỹ rồi chìm. Ngày hôm sau, Đơn vị Đặc công Kamikaze lần đầu tấn công có tổ chức.',
    objective: 'Xuyên qua mưa giông và màn phòng không, đánh chìm Musashi.',
    fact: 'Musashi và Yamato là hai thiết giáp hạm lớn nhất từng được đóng: dài 263 m, lượng giãn nước hơn 72.000 tấn, pháo chính 460 mm.',
    env: { ...DAY, light: 'Mưa giông', sun: [0.3, 0.9, 0.3], sunColor: 0xd8dde6, sunIntensity: 1.5, skyColor: 0x8a96a6, hemiIntensity: 1, fogColor: 0x76838f, fog: 0.0065, seaDeep: 0x10303f, seaShallow: 0x2e5e66, glint: 0.4, cloudsLow: 0.75, cloudsHigh: 0.6, cloudColor: 0xb8c0c8, rain: 0.7, exposure: 1.05 },
    duration: 95, gap: 2.4,
    roster: { fighter: ['zero', 'george'], bomber: ['kate', 'betty'], diver: ['val'], suicide: ['kamikaze'] },
    formations: { vee: 3, column: 3, wall: 2, crossing: 2, loops: 2, divers: 2, heavy: 1, behind: 1, swarm: 1, convoy: 2, cruiser: 1 },
    setPieces: [{ t: 30, formation: 'cruiser', kind: 'cruiser', n: 2 }, { t: 70, formation: 'swarm', kind: 'kamikaze', n: 6 }],
    scenery: { every: 85, kinds: ['jungle', 'island', 'reef'], specials: [{ at: 20, kind: 'coast', x: -27, scale: 1.1 }] },
    boss: 'musashi', bossIntel: 'Musashi: ba tháp pháo 460 mm, bốn ụ phòng không và đài chỉ huy. Đạn hồng to bay chậm nhưng dày.',
    seed: 1944_10,
  },
  {
    index: 8, key: 'iwo', title: 'Iwo Jima', place: 'Iwo Jima, quần đảo Bonin', date: '23/2/1945', year: 1945, month: 2,
    brief: 'Hòn đảo núi lửa rộng 21 km² được khoảng 21.000 quân Nhật dưới quyền Tướng Kuribayashi biến thành pháo đài với khoảng 18 km đường hầm. Ngày 23/2/1945, lá cờ Mỹ được cắm trên đỉnh núi Suribachi; trận đánh kéo dài đến 26/3.',
    objective: 'Yểm trợ Thủy quân Lục chiến đổ bộ: phá các trận địa phòng không và pháo đài Suribachi.',
    fact: 'Sân bay trên Iwo Jima về sau cứu hơn 2.000 máy bay ném bom B-29 hư hỏng phải hạ cánh khẩn cấp trên đường về từ Nhật Bản.',
    env: { ...DAY, light: 'Trời xám', sun: [0.5, 0.78, 0.35], sunColor: 0xf0e8dc, sunIntensity: 2, skyColor: 0xa8b4c0, fogColor: 0x9aa4ac, fog: 0.005, seaDeep: 0x123a52, seaShallow: 0x3f7a84, glint: 0.7, cloudsLow: 0.45, cloudsHigh: 0.35, cloudColor: 0xe8ecef, exposure: 1 },
    duration: 95, gap: 2.4,
    roster: { fighter: ['zero', 'frank'], bomber: ['betty'], diver: ['val'], suicide: ['kamikaze'] },
    formations: { vee: 3, column: 3, wall: 1, crossing: 2, loops: 2, divers: 1, heavy: 1, behind: 1, aaSite: 3, swarm: 1 },
    setPieces: [{ t: 18, formation: 'aaSite', n: 4, x: -10 }, { t: 50, formation: 'aaSite', n: 5, x: 8 }],
    scenery: { every: 120, kinds: ['reef'], specials: [{ at: 30, kind: 'landingCraft', x: -14, scale: 1 }, { at: 60, kind: 'landingCraft', x: 12, scale: 1 }, { at: 520, kind: 'iwoJima', x: 0, scale: 1 }] },
    boss: 'suribachi', bossIntel: 'Hai khẩu pháo bờ biển lớn hai bên và bốn ụ phòng không quanh miệng núi lửa.',
    seed: 1945_02,
  },
  {
    index: 9, key: 'okinawa', title: 'Okinawa — Chiến dịch Ten-Go', place: 'Biển Hoa Đông, tây nam Kyūshū', date: '7/4/1945', year: 1945, month: 4,
    brief: 'Okinawa là trận đánh đẫm máu nhất mặt trận Thái Bình Dương, nơi hàng nghìn phi vụ kamikaze lao vào hạm đội Mỹ. Ngày 7/4/1945, thiết giáp hạm Yamato ra khơi trong một nhiệm vụ được coi là cảm tử, không có yểm trợ trên không; khoảng 380 máy bay Mỹ tấn công và Yamato chìm ở phía tây nam Kyūshū.',
    objective: 'Đánh bật các đợt kamikaze và bom bay Ōka, rồi đánh chìm Yamato.',
    fact: 'Ngày 2/9/1945, Nhật Bản ký văn kiện đầu hàng trên thiết giáp hạm USS Missouri trong vịnh Tokyo, khép lại Thế chiến II.',
    env: { ...DAY, light: 'Hoàng hôn', sun: [-0.8, 0.4, -0.3], sunColor: 0xff9a5a, sunIntensity: 2.2, skyColor: 0xe8a07a, groundColor: 0x2a2a3a, fogColor: 0xc88a70, fog: 0.0052, seaDeep: 0x152a48, seaShallow: 0x3a5f78, glint: 1.6, cloudsLow: 0.5, cloudsHigh: 0.4, cloudColor: 0xffc4a0, exposure: 0.95 },
    duration: 100, gap: 2.2,
    roster: { fighter: ['zero', 'frank', 'george'], bomber: ['betty'], diver: ['val'], suicide: ['kamikaze'] },
    formations: { vee: 3, column: 3, wall: 2, crossing: 2, loops: 2, divers: 1, heavy: 1, behind: 1, swarm: 3, ohka: 2, convoy: 1 },
    setPieces: [{ t: 25, formation: 'swarm', kind: 'kamikaze', n: 8 }, { t: 55, formation: 'ohka', n: 4 }, { t: 80, formation: 'swarm', kind: 'kamikaze', n: 10 }],
    scenery: { every: 110, kinds: ['island', 'reef'], specials: [{ at: 15, kind: 'coast', x: 27, scale: 1.2, rot: Math.PI }, { at: 140, kind: 'usCarrier', x: -18, scale: 1 }] },
    boss: 'yamato', bossIntel: 'Yamato: ba tháp pháo 460 mm, hai tháp pháo phụ, bốn ụ phòng không và đài chỉ huy. Trận cuối cùng.',
    seed: 1945_04,
  },
];

export const LEVEL_COUNT = LEVELS.length;

/** The closing words after the last level. */
export const EPILOGUE =
  'Ngày 2/9/1945, trên boong thiết giáp hạm USS Missouri giữa vịnh Tokyo, Nhật Bản ký văn kiện đầu hàng. Chiến tranh Thái Bình Dương kết thúc sau gần bốn năm, cướp đi sinh mạng của hàng triệu người — binh lính và thường dân ở khắp châu Á – Thái Bình Dương.';
