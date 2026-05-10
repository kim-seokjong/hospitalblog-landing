/**
 * Procedure-specific visual cues for AI image generation.
 *
 * Maps Korean medical/aesthetic procedure keywords to English visual descriptions
 * that help gpt-image-2 / fal.ai produce images where the procedure is instantly
 * recognizable. Used by /api/generate-images via buildFluxPrompts.
 */

export const PROCEDURE_VISUAL_CUES: Record<string, string> = {
  // ── 피부과 / 미용 시술 ──
  '보톡스': 'ultra-fine medical needle approaching glabella, forehead, or jaw with marked dot injection points, sterile gloved hands holding small syringe, side-by-side before-after showing dynamic frown lines vs relaxed smooth skin, medical aesthetic clinic setting',
  '필러': 'syringe with cannula gently positioned at nasolabial fold, lip, or cheek with marked volumetric area, sterile gloves, before-after comparison showing volume restoration, dermal filler vial visible on tray',
  '물광': 'dewy glass-skin reflective sheen on cheeks, mesotherapy injection gun with multiple micro-needles on cheek, hyaluronic acid droplets glistening on plump hydrated skin, before-after dryness vs glow',
  '스킨부스터': 'mesotherapy gun on cheek with tiny injection marks, hydrated juicy plump skin texture, hyaluronic acid serum vial, glass-skin appearance close-up',
  '레이저 토닝': 'Q-switched laser handpiece emitting pinpoint green-yellow light on patient cheek, protective black eye goggles, fading melasma and dark spots before-after comparison',
  '레이저': 'aesthetic laser handpiece with focused light beam on patient face, protective goggles on patient eyes, sterile clinic environment with monitor showing settings',
  '여드름': 'active inflammatory papules and comedones on cheek, dermatologist examining with magnifying lamp or Wood\'s light, post-inflammatory hyperpigmentation marks, gentle extraction tool nearby',
  '미백': 'before-after of pigmented vs even-toned skin tone, brightening serum dropper on glowing cheek, vitamin C ampoule, dermatologist applying brightening cream',
  '색소': 'pigmented spots and freckles on cheek visible, IPL or pico-laser device handpiece, before-after fading spots, dermatologist marking treatment area',
  '점 제거': 'small mole on cheek being treated with CO2 laser pen, after image showing tiny scab and healing skin, dermatologist closeup with fine instrument',
  '흉터': 'fractional laser handpiece on acne-scarred cheek, before-after skin texture improvement, microneedling roller, atrophic scar close-up',
  '모공': 'close-up split frame of skin with enlarged pores before and refined smooth pores after, dermatologist using pore-cleansing device with vacuum tip',
  '피부 트러블': 'irritated red patches on face, dermatologist applying soothing barrier cream, calm clear skin in after frame, sensitive-skin product lineup',
  '주름': 'forehead and around-eyes wrinkles in before frame, smooth refreshed skin in after frame, anti-aging serum dropper, dermatologist marking treatment lines',
  '리프팅': 'HIFU or thread-lifting handheld device on jawline, marked treatment grid lines on face, jawline tightening before-after, ultrasound transducer focused on cheek',
  '리프팅 시술': 'thread lifting needle entry near temple with cog threads visible under skin schematic, jaw contouring before-after, lifting device on tray',

  // ── 정형외과 / 재활 ──
  '도수치료': 'physical therapist hands manipulating patient\'s lumbar or cervical spine on therapy table, kinesiology tape visible on shoulder or back, posture correction in progress, modern PT clinic',
  '도수': 'physical therapist hands on patient back, therapy bed setting, manual mobilization technique, sports medicine clinic',
  '허리 디스크': 'spine MRI image lightbox with herniated disc clearly highlighted in red, patient lying prone on table with lower-back palpation, doctor pointing at MRI screen',
  '디스크': 'MRI of lumbar spine with herniated disc, doctor explaining to patient pointing at screen, anatomy model of vertebrae on desk',
  '무릎 통증': 'doctor examining patient knee joint with goniometer, knee X-ray on monitor showing joint space, patient wincing during range-of-motion test',
  '무릎': 'knee anatomy model, doctor palpating knee joint, X-ray of knee on lightbox, kinesiology tape on patella',
  '어깨 통증': 'patient seated as doctor tests shoulder rotation, frozen-shoulder stretching with resistance band, ultrasound probe on shoulder joint',
  '어깨': 'shoulder examination, rotator cuff anatomy chart, ultrasound probe on deltoid, kinesiology tape on shoulder',
  '척추': 'spine alignment chart on wall, posture analysis with reflective markers on patient back, physical therapist correcting alignment, 3D spine model',
  '척추 교정': 'manual spine adjustment by chiropractor or PT, patient prone on table, spine alignment markers visible, before-after posture comparison',
  '관절염': 'swollen knee or hand joint close-up, X-ray showing joint space narrowing, doctor consulting with elderly patient, joint anatomy model',
  '재활치료': 'patient on rehab equipment doing prescribed exercises, physical therapist guiding movement, parallel bars walking practice, resistance bands',
  '스포츠 손상': 'athlete with knee or ankle injury, ice pack and compression bandage application, sports medicine doctor examining, taping in progress',
  '체외충격파': 'shockwave therapy device probe on patient shoulder or heel, ultrasound gel application, treatment in progress with monitor showing intensity',

  // ── 치과 ──
  '임플란트': 'dental chair with patient mouth open, panoramic dental X-ray showing titanium implant fixture in jawbone, dentist using surgical handpiece with light, sterile dental tray with implant components',
  '치아 교정': 'patient mouth showing braces or clear aligners on teeth, before-after teeth alignment comparison, orthodontist holding aligner tray, retainer case',
  '교정': 'orthodontic braces on teeth close-up, clear aligners, dental wire and brackets, smile transformation',
  '스케일링': 'dental hygienist using ultrasonic scaler on patient teeth with water spray, before-after plaque and tartar removal, suction tube',
  '충치': 'cavity visible on tooth in mirror, dentist using dental probe, dental drill close-up with water cooling, before-after composite filling',
  '치아 미백': 'whitening tray with peroxide gel on teeth, blue LED whitening lamp, before-after teeth shade comparison with shade guide',
  '라미네이트': 'thin porcelain veneer being placed on front tooth, dentist holding veneer with tweezers, smile transformation before-after, shade matching',
  '사랑니': 'dental panoramic X-ray showing impacted wisdom tooth, oral surgeon with extraction tools, surgical loupe and mask, gauze on tray',
  '잇몸': 'inflamed red gums close-up, periodontal probe measuring pocket depth, dentist gently treating gumline with laser, healthy pink gum after',
  '잇몸 치료': 'periodontal treatment in progress, scaling root planing tool, before-after gum health',

  // ── 한의원 / 한방 ──
  '추나요법': 'Korean traditional clinic setting with hanji-paneled walls, hanui doctor in white robe performing manual spinal adjustment on patient lumbar, traditional medicine cabinet with herb drawers in background',
  '추나': 'manual spinal manipulation in Korean hanui clinic, hanui doctor hands on patient back, traditional clinic interior with calligraphy',
  '침': 'multiple thin acupuncture needles arranged on patient back, face, or limb meridian points, traditional Korean clinic, hanui doctor in white coat with calm focused expression',
  '침 치료': 'acupuncture needles on patient face or back meridian points, traditional Korean herbal medicine cabinet behind, dim warm calming lighting',
  '한약': 'simmering ceramic herb pot with steam, dried herbs in pharmacy drawers labeled in hanja, packaged liquid herbal medicine pouches, hanui pharmacist measuring herbs',
  '다이어트 한의원': 'patient body composition analyzer measurement, herbal diet medicine pouches arranged, hanui doctor consulting on lifestyle and diet plan',
  '갱년기': 'middle-aged Korean woman in hanui consultation, hanui doctor taking pulse on her wrist (mac-jin), traditional medicine cabinet with herbs',
  '아토피': 'inflamed eczema patches on inner elbow or skin, herbal cream application, hanui consultation with patient, soothing herbal extract bottles',
  '면역력': 'immunity-boosting Korean herb display with ginseng roots and reishi, hanui consultation, herbal tonic preparation',

  // ── 성형외과 ──
  '쌍꺼풀': 'patient eye area with marked surgical lines for double-eyelid procedure, plastic surgeon using fine forceps, before-after eye shape comparison, sterile drape',
  '코 성형': 'profile view of nose with surgical markings for rhinoplasty, consultation with handheld mirror, before-after nose bridge and tip shape comparison',
  '지방흡입': 'patient marked with surgical lines on abdomen or thigh, liposuction cannula tool on tray, before-after body contour silhouette, surgical drape',
  '가슴 성형': 'consultation room with breast implant size samples on table, surgical area covered with modest gown, plastic surgeon discussing with patient using diagram',
  '안면윤곽': 'patient face with V-line surgical markings on jaw and zygoma, 3D facial scan on monitor, before-after jawline and face shape comparison',
  '눈 성형': 'eye area with precise surgical markings, cosmetic surgeon with fine forceps and microscissors, before-after eye shape, sterile field',

  // ── 내과 ──
  '건강검진': 'comprehensive health checkup setting, patient with blood pressure cuff, blood test tubes lined up, ultrasound probe on abdomen, ECG leads, height-weight scale',
  '당뇨': 'glucometer with blood drop on test strip, insulin pen on table, healthy diet plate visualization, doctor examining diabetic foot',
  '고혈압': 'blood pressure monitor with cuff on patient arm, doctor checking digital reading on screen, healthy lifestyle infographic, salt-reduced diet display',
  '내시경': 'endoscope tube being prepared, monitor showing internal stomach or colon view, patient on examination bed under sedation with mouthpiece',
  '갑상선': 'doctor palpating patient neck thyroid area, ultrasound probe on neck with screen showing thyroid scan, thyroid model on desk',
  '소화기': 'doctor pressing patient abdomen during examination, abdominal ultrasound probe, digestive system anatomy chart on wall',
  '대장암': 'colonoscopy preparation room, polyp removal scene on monitor, doctor explaining colonoscopy results to patient',

  // ── 산부인과 ──
  '임신': 'pregnant Korean woman with hand on belly, prenatal ultrasound on screen showing fetal silhouette, OBGYN doctor examining with handheld doppler',
  '출산': 'delivery room interior (modest framing), newborn baby being weighed and wrapped, mother holding infant skin-to-skin, hospital setting',
  '난임': 'consultation room with reproductive endocrinologist, hopeful couple holding hands across desk, fertility chart and ultrasound image, calm atmosphere',
  '자궁근종': 'pelvic ultrasound on screen showing uterine fibroid clearly, OBGYN consultation with patient using anatomical diagram',
  '여성 건강': 'women health checkup environment, female doctor with female patient consultation, pelvic ultrasound machine, female-friendly clinic decor',

  // ── 소아청소년과 ──
  '예방접종': 'baby or young child receiving small needle vaccine in upper arm or thigh, parent comforting child, pediatric clinic with toys and bright child-friendly decor',
  '성장 클리닉': 'child measured with stadiometer for height, growth chart on wall with percentile lines, pediatric endocrinologist consulting with parents',
  '소아': 'pediatric clinic with playful colorful interior, small Korean child patient with parent, doctor with stethoscope listening to child chest',
  '소아과': 'pediatric clinic with bright friendly interior, doctor examining small child with stethoscope and otoscope, parent nearby, toys visible',

  // ── 안과 ──
  '라식': 'excimer laser dome above patient lying down, eye speculum holding eyelid (clinical view), before-after vision chart, sterile drape on face',
  '라섹': 'PRK laser procedure scene, protective therapeutic contact lens being applied with forceps, patient lying calmly, slit-lamp examination after',
  '백내장': 'eye showing cloudy lens before vs clear after, IOL intraocular lens being prepared, slit-lamp examination, doctor with microscope',
  '녹내장': 'tonometer measuring intraocular eye pressure, optical coherence tomography scan of optic nerve on screen, eye drop application',
  '드림렌즈': 'orthokeratology night-wear contact lens on fingertip, child trying lens with parent, before-after vision chart',
  '시력': 'vision test chart on wall, optometrist with phoropter on patient face during refraction test, eye examination',

  // ── 이비인후과 ──
  '코막힘': 'nasal endoscope thin tube examination by ENT doctor, patient with congested nose visible on side, saline nasal spray on table',
  '축농증': 'sinus CT scan on monitor showing sinus opacification, doctor pointing at sinusitis area, nasal irrigation neti pot or device',
  '편도선': 'tongue depressor showing inflamed enlarged tonsils in throat, doctor examining throat with bright headlight, swab on tray',
  '중이염': 'otoscope examining child ear with parent holding child, eardrum view on connected monitor showing redness and effusion',
  '이명': 'audiometric soundproof testing booth with patient wearing headphones, hearing chart on screen, ENT consultation discussing tinnitus',
  '수면무호흡': 'CPAP machine and mask on bedside table, sleep study polysomnography setup with multiple sensors on patient, sleep clinic environment',
  '코피': 'nasal cautery procedure with silver nitrate stick, gauze packing application by ENT doctor, otoscope examination',

  // ── 일반 / 폴백 ──
  '진료': 'Korean doctor in white coat consulting with patient face-to-face, modern clinic interior, examination tools on desk, calm professional atmosphere',
  '치료': 'medical treatment in progress, Korean medical staff with patient, sterile clinic environment with appropriate equipment',
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
