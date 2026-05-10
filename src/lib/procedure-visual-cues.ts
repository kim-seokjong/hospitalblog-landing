/**
 * Procedure-specific visual cues for AI image generation.
 *
 * Maps Korean medical/aesthetic procedure keywords to English visual descriptions
 * that help gpt-image-2 / fal.ai produce images where the procedure is instantly
 * recognizable. Used by /api/generate-images via buildFluxPrompts.
 *
 * 의료광고법(의료법 제56조) 컴플라이언스:
 * - before-after 비교 표현 절대 금지
 * - 효과 보장·과장 표현 금지 (miraculous, dramatic transformation, perfect 등)
 * - 수치 결과 암시 금지 (70% improvement 등)
 * - 모든 큐는 "시술 진행 장면" 자체에 집중 (도구·부위·의료진 동작·환경)
 */

export const PROCEDURE_VISUAL_CUES: Record<string, string> = {
  // ── 피부과 / 미용 시술 ──
  '보톡스': 'ultra-fine medical needle approaching glabella, forehead, or jaw area with marked dot injection points on skin, sterile gloved hands holding small syringe, patient relaxed in treatment chair with focused calm expression, medical aesthetic clinic setting with sterile drape',
  '필러': 'syringe with cannula gently positioned near nasolabial fold, lip, or cheek with marked treatment area, sterile gloves and drape, dermal filler vial visible on stainless steel tray, dermatologist with focused expression during procedure',
  '물광': 'mesotherapy injection gun with multiple micro-needle head on patient cheek, hyaluronic acid serum vial on tray, sterile gloved hands holding the device, patient lying calmly on treatment bed, clinical aesthetic setting',
  '스킨부스터': 'mesotherapy gun applied to cheek area with tiny entry marks visible, hyaluronic acid serum vial and sterile syringe on tray, dermatologist focused on treatment, clinic interior',
  '레이저 토닝': 'Q-switched laser handpiece emitting pinpoint focused light on patient cheek, protective black eye goggles worn by patient, dermatologist holding device with steady hand, sterile clinical environment with monitor showing settings',
  '레이저': 'aesthetic laser handpiece with focused beam directed at patient face, protective goggles on patient eyes, sterile clinic environment, monitor displaying device parameters, dermatologist concentrating on treatment area',
  '여드름': 'inflammatory acne papules and comedones visible on cheek, dermatologist examining with magnifying lamp or Wood\'s light in dim room, gentle extraction tool nearby, dermatology consultation setting',
  '미백': 'brightening serum dropper applied to cleansed cheek, vitamin C ampoule on tray, dermatologist applying product with gloved fingertip, sterile clinic environment, focused treatment scene',
  '색소': 'pigmented spots and freckles on cheek being examined under bright clinic light, IPL or pico-laser device handpiece on tray, dermatologist marking treatment area with skin pencil',
  '점 제거': 'small mole on cheek being treated with CO2 laser pen, magnifying loupe worn by dermatologist, sterile field setup, focused clinical close-up of treatment in progress',
  '흉터': 'fractional laser handpiece applied to acne-scarred cheek, microneedling roller on sterile tray, atrophic scar texture visible under magnification, dermatologist mid-treatment',
  '모공': 'pore-cleansing device with vacuum tip on cheek surface, magnified skin view on monitor showing pore structure, dermatologist focused during extraction session',
  '피부 트러블': 'irritated red patches on face being examined by dermatologist, soothing barrier cream tube on tray, sensitive-skin product lineup, calm clinical consultation atmosphere',
  '주름': 'forehead and around-eyes area being examined under bright examination light, anti-aging serum dropper and ampoules on tray, dermatologist marking treatment lines with skin pencil',
  '리프팅': 'HIFU or thread-lifting handheld device on jawline area with marked treatment grid lines on patient face, ultrasound transducer focused on cheek, dermatologist concentrating during procedure',
  '리프팅 시술': 'thread lifting needle near temple with sterile drape, lifting device tray with cogs and cannulas, dermatologist with focused expression, sterile aesthetic clinic setting',

  // ── 정형외과 / 재활 ──
  '도수치료': 'physical therapist hands manipulating patient lumbar or cervical spine on therapy table, kinesiology tape visible on shoulder or back, posture correction in progress, modern PT clinic interior',
  '도수': 'physical therapist hands on patient back during manual mobilization technique, therapy bed setting, sports medicine clinic with anatomy charts',
  '허리 디스크': 'spine MRI image displayed on lightbox or monitor with herniated disc area highlighted, patient lying prone on table with lower-back palpation, doctor pointing at MRI scan during consultation',
  '디스크': 'lumbar spine MRI scan on monitor, doctor explaining anatomy to patient pointing at screen, vertebrae anatomy model on desk, clinical consultation',
  '무릎 통증': 'doctor examining patient knee joint with goniometer, knee X-ray displayed on monitor showing joint structure, range-of-motion test in progress',
  '무릎': 'knee anatomy model on desk, doctor palpating knee joint during examination, X-ray of knee on lightbox, kinesiology tape applied around patella',
  '어깨 통증': 'patient seated as doctor tests shoulder rotation manually, frozen-shoulder stretching exercise with resistance band, ultrasound probe applied to shoulder joint',
  '어깨': 'shoulder examination by physician, rotator cuff anatomy chart on wall, ultrasound probe on deltoid area, kinesiology tape on shoulder',
  '척추': 'spine alignment chart on wall, posture analysis with reflective markers placed on patient back, physical therapist correcting alignment, 3D spine model on desk',
  '척추 교정': 'manual spine adjustment by chiropractor or PT, patient prone on therapy table, spine alignment markers visible, clinical setting with anatomy charts',
  '관절염': 'swollen knee or hand joint being examined close-up, X-ray on monitor showing joint structure, doctor consulting with elderly patient, joint anatomy model nearby',
  '재활치료': 'patient on rehabilitation equipment performing prescribed exercises, physical therapist guiding movement with hands-on assistance, parallel bars and resistance bands visible',
  '스포츠 손상': 'athlete with knee or ankle being examined by sports medicine doctor, ice pack and compression bandage application, kinesiology taping in progress on injury site',
  '체외충격파': 'shockwave therapy device probe applied to patient shoulder or heel with ultrasound gel, treatment in progress, monitor showing intensity and frequency settings',

  // ── 치과 ──
  '임플란트': 'dental chair with patient mouth open, panoramic dental X-ray displayed on monitor, dentist using surgical handpiece with operating light, sterile dental tray with implant components arranged',
  '치아 교정': 'patient mouth open showing braces or clear aligners on teeth, orthodontist holding aligner tray with retainer case nearby, dental clinic with examination lamp',
  '교정': 'orthodontic braces close-up on teeth, clear aligners on dental cast, archwire and bracket components on sterile tray, dental clinic setting',
  '스케일링': 'dental hygienist using ultrasonic scaler on patient teeth with water spray, suction tube held by assistant, sterile dental setup',
  '충치': 'dentist using mirror and explorer probe to examine teeth, dental drill close-up with water cooling, composite filling material on tray',
  '치아 미백': 'whitening tray with peroxide gel applied to teeth, blue LED whitening lamp positioned, dentist with shade guide chart',
  '라미네이트': 'thin porcelain veneer being held with tweezers by dentist, dental cast model on table, shade matching guide nearby, sterile clinical setup',
  '사랑니': 'dental panoramic X-ray showing impacted wisdom tooth on monitor, oral surgeon with surgical extraction tools and loupe, sterile gauze on tray, surgical mask',
  '잇몸': 'periodontal probe measuring gum pocket depth, dentist gently treating gumline with hand instrument, clinical close-up of gum examination',
  '잇몸 치료': 'periodontal treatment in progress with scaling and root planing tool, dentist focused on gum line, sterile clinical setup',

  // ── 한의원 / 한방 ──
  '추나요법': 'Korean traditional clinic interior with hanji-paneled walls, hanui doctor in white robe performing manual spinal adjustment on patient lumbar area, traditional medicine cabinet with herb drawers in background',
  '추나': 'manual spinal manipulation in Korean hanui clinic, hanui doctor hands on patient back, traditional clinic interior with calligraphy artwork',
  '침': 'multiple thin acupuncture needles arranged on patient back or face along meridian points, traditional Korean clinic atmosphere, hanui doctor with focused calm expression in white coat',
  '침 치료': 'acupuncture needles placed on patient face or back at meridian points, traditional Korean herbal medicine cabinet behind, dim warm calming lighting',
  '한약': 'simmering ceramic herb pot with rising steam, dried herbs in pharmacy drawers labeled with hanja characters, packaged liquid herbal medicine pouches, hanui pharmacist measuring herbs',
  '다이어트 한의원': 'patient body composition analyzer measurement in progress, herbal diet medicine pouches arranged on desk, hanui doctor consulting on lifestyle plan',
  '갱년기': 'middle-aged Korean woman in hanui consultation, hanui doctor taking pulse on her wrist (mac-jin technique), traditional medicine cabinet with herb drawers',
  '아토피': 'inflamed eczema patches on inner elbow or arm being examined, herbal cream tube on tray, hanui consultation in progress with soothing herbal extract bottles',
  '면역력': 'immunity-boosting Korean herbs displayed including ginseng roots and reishi mushroom, hanui consultation with patient, herbal tonic preparation on counter',

  // ── 성형외과 ──
  '쌍꺼풀': 'patient eye area with marked surgical lines for double-eyelid procedure, plastic surgeon holding fine forceps and microscissors, sterile drape covering forehead, surgical loupe magnification',
  '코 성형': 'profile view of nose with surgical markings for rhinoplasty, consultation handheld mirror in patient hand, plastic surgeon explaining shape on diagram',
  '지방흡입': 'patient marked with surgical lines on abdomen or thigh covered with sterile drape, liposuction cannula tool on instrument tray, surgeon in scrubs preparing for procedure',
  '가슴 성형': 'consultation room with breast implant size sample dishes on table, plastic surgeon discussing options with patient using anatomical diagram, modest framing',
  '안면윤곽': 'patient face with V-line surgical markings on jaw and zygoma area, 3D facial scan displayed on monitor, plastic surgeon analyzing measurements',
  '눈 성형': 'eye area with precise surgical markings, cosmetic surgeon holding fine forceps and microscissors under sterile field, surgical loupe and magnification',

  // ── 내과 ──
  '건강검진': 'comprehensive health checkup setting with patient wearing blood pressure cuff, blood test tubes lined up on rack, ultrasound probe on abdomen, ECG leads attached, height-weight scale nearby',
  '당뇨': 'glucometer with blood drop on test strip held in patient finger, insulin pen on table beside healthy diet plate visualization, doctor examining diabetic foot',
  '고혈압': 'blood pressure monitor with cuff on patient arm, doctor checking digital reading on screen, lifestyle and dietary infographic on wall',
  '내시경': 'endoscope tube being prepared by nurse, monitor showing internal stomach or colon view, patient on examination bed under sedation with mouthpiece in place',
  '갑상선': 'doctor palpating patient neck thyroid area with both hands, ultrasound probe on neck with screen showing thyroid scan, thyroid anatomy model on desk',
  '소화기': 'doctor pressing patient abdomen during physical examination, abdominal ultrasound probe and gel, digestive system anatomy chart on wall',
  '대장암': 'colonoscopy procedure room with monitor displaying internal view, doctor in scrubs operating endoscope, polyp removal in progress on screen',

  // ── 산부인과 ──
  '임신': 'pregnant Korean woman in OBGYN clinic with hand on belly, prenatal ultrasound on monitor showing fetal silhouette, OBGYN doctor performing examination with handheld doppler',
  '출산': 'delivery room interior with modest framing, newborn baby being weighed and wrapped by nurse, mother holding infant skin-to-skin with calm expression, hospital postpartum setting',
  '난임': 'consultation room with reproductive endocrinologist, hopeful Korean couple holding hands across desk, fertility chart and ultrasound image on monitor, calm professional atmosphere',
  '자궁근종': 'pelvic ultrasound on screen showing uterine fibroid clearly, OBGYN consultation with patient using anatomical diagram, modest clinical framing',
  '여성 건강': 'women health checkup environment with female doctor and female patient consultation, pelvic ultrasound machine, female-friendly clinic decor',

  // ── 소아청소년과 ──
  '예방접종': 'baby or young child receiving small needle vaccine in upper arm or thigh, parent comforting child with hand, pediatric clinic with toys and bright child-friendly decor',
  '성장 클리닉': 'child being measured with stadiometer for height, growth chart on wall with percentile lines, pediatric endocrinologist consulting with parents using growth data',
  '소아': 'pediatric clinic with playful colorful interior, small Korean child patient with parent nearby, doctor with stethoscope listening to child chest gently',
  '소아과': 'pediatric clinic with bright friendly interior, doctor examining small child with stethoscope and otoscope, parent supporting child, toys and child-height furniture',

  // ── 안과 ──
  '라식': 'excimer laser dome positioned above patient lying down, eye speculum holding eyelid in clinical view, sterile drape covering face, surgical microscope nearby',
  '라섹': 'PRK laser procedure scene with patient lying calmly, protective therapeutic contact lens being applied with forceps, slit-lamp examination station',
  '백내장': 'IOL intraocular lens being prepared on sterile tray, slit-lamp examination of patient eye in progress, ophthalmologist with surgical microscope, operating room setup',
  '녹내장': 'tonometer measuring intraocular eye pressure on patient, optical coherence tomography scan of optic nerve displayed on screen, eye drop application during examination',
  '드림렌즈': 'orthokeratology night-wear contact lens on fingertip held by optometrist, child trying lens with parent nearby, vision examination chart',
  '시력': 'vision test chart on wall with patient seated for examination, optometrist using phoropter on patient face during refraction test, ophthalmologic clinic',

  // ── 이비인후과 ──
  '코막힘': 'nasal endoscope thin tube examination by ENT doctor, patient with congested nose visible from side, saline nasal spray bottle on tray',
  '축농증': 'sinus CT scan on monitor showing sinus anatomy, doctor pointing at examination findings, nasal irrigation neti pot or device on counter',
  '편도선': 'tongue depressor showing inflamed tonsils in throat under bright light, ENT doctor examining with headlight, swab on sterile tray',
  '중이염': 'otoscope examining child ear with parent holding child gently, eardrum view displayed on connected monitor for parent to see',
  '이명': 'audiometric soundproof testing booth with patient wearing headphones, hearing chart on screen, ENT doctor consulting with patient',
  '수면무호흡': 'CPAP machine and mask on bedside table, sleep study polysomnography setup with multiple sensors on patient, sleep clinic environment',
  '코피': 'nasal cautery procedure with silver nitrate stick held by ENT doctor, sterile gauze on tray, otoscope examination scene',

  // ── 일반 / 폴백 ──
  '진료': 'Korean doctor in white coat consulting with patient face-to-face across desk, modern clinic interior, examination tools on desk, calm professional atmosphere',
  '치료': 'medical treatment in progress with Korean medical staff and patient, sterile clinic environment with appropriate equipment for the procedure',
};

/**
 * Match user keyword(s) against the visual cues dictionary.
 * Splits by comma/space, performs exact then substring matching.
 * Returns deduplicated cue strings (max 3 to keep prompts focused).
 */
export function findProcedureCues(keyword: string): string[] {
  if (!keyword) return [];
  const tokens = keyword
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const matched = new Set<string>();
  const dictKeys = Object.keys(PROCEDURE_VISUAL_CUES);

  for (const token of tokens) {
    if (PROCEDURE_VISUAL_CUES[token]) {
      matched.add(PROCEDURE_VISUAL_CUES[token]);
      continue;
    }
    for (const key of dictKeys) {
      if (token.includes(key) || key.includes(token)) {
        matched.add(PROCEDURE_VISUAL_CUES[key]);
        break;
      }
    }
    if (matched.size >= 3) break;
  }

  return Array.from(matched).slice(0, 3);
}
