/** Interface text. Arabic is the first language; English is the second. */
export type Lang = 'ar' | 'en';

const STRINGS = {
  title: { ar: 'محاكي اختبار القيادة', en: 'Driving Test Simulator' },
  freeDrive: { ar: 'قيادة حرة', en: 'Free drive' },
  loading: { ar: 'جارٍ التحميل…', en: 'Loading…' },
  loadFailed: {
    ar: 'تعذّر تشغيل المحاكي على هذا المتصفح.',
    en: 'The simulator could not start in this browser.',
  },
  kmh: { ar: 'كم/س', en: 'km/h' },
  rpm: { ar: 'دورة/د', en: 'rpm' },
  gear: { ar: 'الغيار', en: 'Gear' },

  lampEngine: { ar: 'المحرك متوقف', en: 'Engine off' },
  lampHandbrake: { ar: 'فرامل اليد', en: 'Handbrake' },
  lampSeatbelt: { ar: 'حزام الأمان', en: 'Seatbelt' },
  lampLights: { ar: 'الأنوار', en: 'Lights' },
  lampHighBeam: { ar: 'النور العالي', en: 'High beam' },

  start: { ar: 'تشغيل', en: 'Start' },
  handbrake: { ar: 'فرامل اليد', en: 'Handbrake' },
  seatbelt: { ar: 'الحزام', en: 'Belt' },
  camera: { ar: 'الكاميرا', en: 'Camera' },
  reset: { ar: 'إعادة', en: 'Reset' },
  night: { ar: 'ليل / نهار', en: 'Day / night' },
  limit: { ar: 'الحد', en: 'Limit' },
  help: { ar: 'مساعدة', en: 'Help' },
  close: { ar: 'إغلاق', en: 'Close' },
  language: { ar: 'English', en: 'العربية' },
  clutch: { ar: 'القابض', en: 'Clutch' },
  brake: { ar: 'الفرامل', en: 'Brake' },
  gas: { ar: 'الوقود', en: 'Gas' },
  steering: { ar: 'المقود', en: 'Steering' },
  lights: { ar: 'الأنوار', en: 'Lights' },
  horn: { ar: 'البوق', en: 'Horn' },

  camChase: { ar: 'خلف السيارة', en: 'Behind the car' },
  camDriver: { ar: 'مقعد السائق', en: "Driver's seat" },
  camTop: { ar: 'من الأعلى', en: 'From above' },

  msgStartHint: {
    ar: 'شغّل المحرك للبدء',
    en: 'Start the engine to begin',
  },
  msgStalled: {
    ar: 'انطفأ المحرك. اضغط القابض ثم أعد التشغيل.',
    en: 'Stalled. Press the clutch and start the engine again.',
  },
  msgGrindClutch: {
    ar: 'لم يدخل الغيار. اضغط القابض أولاً.',
    en: 'The gear did not go in. Press the clutch first.',
  },
  msgGrindReverse: {
    ar: 'لا يدخل الغيار الخلفي والسيارة تتحرك للأمام.',
    en: 'Reverse will not go in while rolling forwards.',
  },
  msgOverRev: {
    ar: 'غيار منخفض جداً لهذه السرعة!',
    en: 'That gear is too low for this speed!',
  },
  msgReset: { ar: 'أُعيدت السيارة إلى نقطة البداية', en: 'Car returned to the start' },
  msgRotate: {
    ar: 'أدر الهاتف أفقياً لتحكم أسهل',
    en: 'Turn your phone sideways for easier control',
  },

  helpTitle: { ar: 'طريقة التحكم', en: 'Controls' },
  helpKeys: { ar: 'لوحة المفاتيح', en: 'Keyboard' },
  helpMoveOff: { ar: 'للتحرك بالسيارة', en: 'To move off' },
  helpStep1: { ar: 'شغّل المحرك.', en: 'Start the engine.' },
  helpStep2: {
    ar: 'اضغط القابض حتى النهاية واختر الغيار الأول.',
    en: 'Press the clutch all the way and select first gear.',
  },
  helpStep3: { ar: 'حرّر فرامل اليد.', en: 'Release the handbrake.' },
  helpStep4: {
    ar: 'اضغط الوقود قليلاً وارفع القابض ببطء حتى تتحرك السيارة.',
    en: 'Give a little gas and bring the clutch up slowly until the car moves.',
  },
  kSteer: { ar: 'المقود', en: 'Steer' },
  kGas: { ar: 'الوقود', en: 'Gas' },
  kBrake: { ar: 'الفرامل', en: 'Brake' },
  kClutch: { ar: 'القابض (اضغط مطولاً)', en: 'Clutch (hold)' },
  kGearUpDown: { ar: 'غيار أعلى / أدنى', en: 'Gear up / down' },
  kGearDirect: { ar: 'اختيار الغيار مباشرة', en: 'Select a gear directly' },
  kHandbrake: { ar: 'فرامل اليد', en: 'Handbrake' },
  kStart: { ar: 'تشغيل المحرك', en: 'Start engine' },
  kIgnition: { ar: 'إطفاء / فتح المفتاح', en: 'Ignition off / on' },
  kIndicators: { ar: 'إشارة يسار / تحذير / يمين', en: 'Indicate left / hazards / right' },
  kLights: { ar: 'الأنوار', en: 'Lights' },
  kHorn: { ar: 'البوق', en: 'Horn' },
  kSeatbelt: { ar: 'حزام الأمان', en: 'Seatbelt' },
  kMirrors: { ar: 'النظر في المرايا: يسار / وسط / يمين', en: 'Check mirrors: left / centre / right' },
  kCamera: { ar: 'تبديل الكاميرا', en: 'Change camera' },
  kNight: { ar: 'ليل / نهار', en: 'Day / night' },
  kReset: { ar: 'إعادة السيارة', en: 'Reset the car' },
  debugLink: { ar: 'صفحة فحص المحاكاة', en: 'Simulation debug page' },
} as const;

export type StringKey = keyof typeof STRINGS;

const STORAGE_KEY = 'odts.lang';
let current: Lang = 'ar';
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function t(key: StringKey): string {
  return STRINGS[key][current];
}

/** Apply a language to the document (text direction included) and tell listeners. */
export function setLang(lang: Lang): void {
  current = lang;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = t('title');
  }
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Storage unavailable (private window): the choice just does not persist.
  }
  for (const l of listeners) l();
}

/** Arabic unless the user chose English before. */
export function initLang(): Lang {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    saved = null;
  }
  setLang(saved === 'en' ? 'en' : 'ar');
  return current;
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function allKeys(): StringKey[] {
  return Object.keys(STRINGS) as StringKey[];
}

export function translation(key: StringKey, lang: Lang): string {
  return STRINGS[key][lang];
}
