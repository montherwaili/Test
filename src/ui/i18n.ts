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
  msgHonk: { ar: 'سيارة خلفك تنتظر: أنت تعطّل الطريق', en: 'A car behind is waiting: you are blocking the road' },
  rightCar: { ar: 'عدّل السيارة', en: 'Put the car back on its wheels' },
  msgRighted: { ar: 'أُعيدت السيارة على عجلاتها', en: 'Car back on its wheels' },
  kRightCar: { ar: 'عدّل السيارة المقلوبة', en: 'Right a flipped car' },
  sevMinor: { ar: 'خطأ بسيط', en: 'Minor fault' },
  sevSerious: { ar: 'خطأ جسيم', en: 'Serious fault' },
  sevFail: { ar: 'رسوب', en: 'Fail' },
  faultsCount: { ar: 'الأخطاء', en: 'Faults' },
  msgManoeuvreStart: { ar: 'المناورة', en: 'Manoeuvre' },
  msgManoeuvreOk: { ar: 'أحسنت، تمت المناورة', en: 'Well done, manoeuvre complete' },
  msgManoeuvreDone: { ar: 'انتهت المناورة', en: 'Manoeuvre finished' },
  goYard: { ar: 'ساحة الاختبار', en: 'Test yard' },
  goTown: { ar: 'المدينة', en: 'Town' },
  mirrorLeft: { ar: 'مرآة يسار', en: 'Left mirror' },
  mirrorCentre: { ar: 'مرآة وسط', en: 'Mirror' },
  mirrorRight: { ar: 'مرآة يمين', en: 'Right mirror' },
  testRoad: { ar: 'اختبار الطريق', en: 'Road test' },
  testYard: { ar: 'اختبار الساحة', en: 'Yard test' },
  practiseYard: { ar: 'تدريب في الساحة', en: 'Practise in the yard' },
  instrStart: {
    ar: 'شغّل السيارة، وعندما تكون جاهزاً تحرك وتابع الطريق.',
    en: 'Start the car, and move off when you are ready. Follow the road ahead.',
  },
  instrStraight: { ar: 'عند التقاطع القادم، استمر مباشرة.', en: 'At the next junction, go straight on.' },
  instrLeft: { ar: 'عند التقاطع القادم، انعطف يساراً.', en: 'At the next junction, turn left.' },
  instrRight: { ar: 'عند التقاطع القادم، انعطف يميناً.', en: 'At the next junction, turn right.' },
  instrRoundabout: { ar: 'عند الدوّار، خذ المخرج {n}.', en: 'At the roundabout, take the {n} exit.' },
  ord1: { ar: 'الأول', en: 'first' },
  ord2: { ar: 'الثاني', en: 'second' },
  ord3: { ar: 'الثالث', en: 'third' },
  ord4: { ar: 'الرابع', en: 'fourth' },
  instrFinish: {
    ar: 'أوقف السيارة على اليمين في مكان آمن، وشدّ فرامل اليد.',
    en: 'Pull up on the right when it is safe, and set the handbrake.',
  },
  instrOffRoute: { ar: 'ليس من هنا. سأعيدك إلى المسار.', en: 'Not that way. I will take you back on route.' },
  instrYard: {
    ar: 'نفّذ التمارين الأربعة بأي ترتيب: التوقف عند الخط، المرتفع، الاصطفاف للخلف، والاصطفاف الموازي.',
    en: 'Do the four exercises in any order: stop at the line, hill start, reverse parking, parallel parking.',
  },
  msgTestEnded: { ar: 'انتهى الاختبار', en: 'The test is over' },
  msgTimeUp: { ar: 'انتهى وقت الاختبار', en: 'Time is up' },
  resPass: { ar: 'نجحت', en: 'Passed' },
  resFail: { ar: 'لم تنجح', en: 'Not passed' },
  reasonFailFault: { ar: 'خطأ يؤدي إلى الرسوب', en: 'A fault that fails the test' },
  reasonTooManySerious: { ar: 'خطأ جسيم', en: 'A serious fault' },
  reasonTooManyMinor: { ar: 'أخطاء بسيطة أكثر من المسموح', en: 'More minor faults than allowed' },
  reasonIncomplete: { ar: 'لم يكتمل الاختبار', en: 'The test was not completed' },
  resDuration: { ar: 'المدة', en: 'Time' },
  resDistance: { ar: 'المسافة', en: 'Distance' },
  resMinor: { ar: 'بسيطة', en: 'Minor' },
  resSerious: { ar: 'جسيمة', en: 'Serious' },
  resFails: { ar: 'رسوب', en: 'Fail' },
  resFaults: { ar: 'الأخطاء', en: 'Faults' },
  resNoFaults: { ar: 'لا أخطاء. قيادة ممتازة!', en: 'No faults. Excellent driving!' },
  resManoeuvres: { ar: 'التمارين', en: 'Exercises' },
  resNotDone: { ar: 'لم يُنفَّذ', en: 'Not done' },
  resTryAgain: { ar: 'أعد الاختبار', en: 'Try again' },
  resFreeDrive: { ar: 'قيادة حرة', en: 'Free drive' },
  resMap: { ar: 'مسارك وأماكن الأخطاء', en: 'Your drive and where the faults were' },
  resUnverified: {
    ar: 'القواعد افتراضية ولم تُطابق بعد مع اختبار شرطة عُمان السلطانية.',
    en: 'The rules are defaults, not yet checked against the Royal Oman Police test.',
  },
  unitKm: { ar: 'كم', en: 'km' },
  unitM: { ar: 'م', en: 'm' },
  hbOn: { ar: 'فرامل اليد: مشدودة', en: 'Handbrake: ON' },
  hbOff: { ar: 'فرامل اليد: محرَّرة', en: 'Handbrake: off' },
  replayWatch: { ar: 'شاهد الإعادة', en: 'Watch the replay' },
  replayHere: { ar: 'شاهد هذه اللحظة', en: 'Watch this moment' },
  replayBack: { ar: 'رجوع للنتيجة', en: 'Back to the result' },
  replayGraphs: { ar: 'الرسوم', en: 'Graphs' },
  replayPlay: { ar: 'تشغيل', en: 'Play' },
  replayPause: { ar: 'إيقاف مؤقت', en: 'Pause' },
  camFree: { ar: 'كاميرا حرة', en: 'Free camera' },
  freeHint: { ar: 'اسحب لتدوير الكاميرا، وقرّب بإصبعين أو بعجلة الفأرة', en: 'Drag to turn the camera; pinch or scroll to zoom' },
  graphRpm: { ar: 'دورات المحرك', en: 'Engine speed' },
  graphSpeed: { ar: 'السرعة', en: 'Speed' },
  graphPedals: { ar: 'الدواسات', en: 'Pedals' },
  pedThrottle: { ar: 'الوقود', en: 'Gas' },
  pedBrake: { ar: 'الفرامل', en: 'Brake' },
  pedClutch: { ar: 'القابض', en: 'Clutch' },
  lessons: { ar: 'الدروس', en: 'Lessons' },
  lessonGoal: { ar: 'الهدف', en: 'Goal' },
  lessonHint: { ar: 'تلميح', en: 'Hint' },
  lessonDone: { ar: 'أُنجز الدرس', en: 'Lesson complete' },
  lessonNotDone: { ar: 'لم يكتمل الدرس', en: 'Lesson not finished' },
  lessonNext: { ar: 'الدرس التالي', en: 'Next lesson' },
  lessonsMenu: { ar: 'قائمة الدروس', en: 'All lessons' },
  lessonStart: { ar: 'ابدأ', en: 'Start' },
  lessonWellDone: { ar: 'أحسنت!', en: 'Well done!' },
  recommended: { ar: 'مقترح لك', en: 'Suggested for you' },
  practiseWeakest: { ar: 'تدرّب على ما تخطئ فيه أكثر', en: 'Practise what you get wrong most' },
  testsTaken: { ar: 'الاختبارات: {n}، نجحت في {p}', en: 'Tests: {n} taken, {p} passed' },
  lessonRetry: { ar: 'أعد الدرس', en: 'Try the lesson again' },
  close2: { ar: 'إغلاق', en: 'Close' },
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

export function t(key: StringKey, vars?: Record<string, string>): string {
  let text: string = STRINGS[key][current];
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, v);
  return text;
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
