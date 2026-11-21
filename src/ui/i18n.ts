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
  settings: { ar: 'الإعدادات', en: 'Settings' },
  setSound: { ar: 'الصوت والاهتزاز', en: 'Sound and vibration' },
  setSoundOn: { ar: 'الصوت', en: 'Sound' },
  setVolume: { ar: 'مستوى الصوت', en: 'Volume' },
  setVibration: { ar: 'اهتزاز الهاتف عند الاصطدام والمطبات', en: 'Vibrate on bumps and knocks' },
  setSteering: { ar: 'التوجيه على شاشة اللمس', en: 'Steering on a touch screen' },
  setSteerWheel: { ar: 'مقود على الشاشة', en: 'On-screen wheel' },
  setSteerTilt: { ar: 'إمالة الهاتف', en: 'Tilt the phone' },
  setTiltHow: {
    ar: 'أمسك الهاتف أفقياً وأدره مثل المقود. المس المقود على الشاشة لتوجّه بإصبعك متى شئت.',
    en: 'Hold the phone sideways and turn it like a wheel. Touch the on-screen wheel to steer by finger at any time.',
  },
  setTiltRefused: {
    ar: 'لم يُسمح باستخدام حسّاس الحركة، أو أن الجهاز لا يملكه.',
    en: 'The motion sensor was not allowed, or this device has none.',
  },
  setTiltRange: { ar: 'الإمالة اللازمة لأقصى توجيه', en: 'Tilt for full lock' },
  setTiltCentre: { ar: 'اجعل وضع الهاتف الحالي هو المستقيم', en: 'Set straight ahead to how I hold it now' },
  setPicture: { ar: 'الصورة', en: 'Picture' },
  setGearbox: { ar: 'ناقل الحركة', en: 'Gearbox' },
  languageShort: { ar: 'EN', en: 'ع' },
  freeHighway: { ar: 'الطريق السريع', en: 'Motorway' },
  freeCity: { ar: 'المدينة', en: 'City' },
  helpStep2Auto: { ar: 'اختر الغيار الأول (E). الكلتش يشتغل لحاله.', en: 'Select first gear (E). The clutch works itself.' },
  helpStep2Automatic: { ar: 'اختر D (E).', en: 'Select D (E).' },
  helpStep4Auto: { ar: 'اضغط الوقود بهدوء (W). في اليدوي بدّل للأعلى بـ E مع ازدياد السرعة.', en: 'Press the accelerator gently (W). In manual, change up with E as you gather speed.' },
  navLessons: { ar: 'الدروس', en: 'Lessons' },
  navDrive: { ar: 'قيادة حرة', en: 'Free drive' },
  navPractise: { ar: 'تدريب مع الفاحص', en: 'Practice with the examiner' },
  navTest: { ar: 'الاختبار', en: 'The test' },
  lessonsLead: { ar: 'سبعة دروس قصيرة بالترتيب، من تشغيل السيارة إلى جولة كاملة.', en: 'Seven short lessons in order, from starting the car to a full drive.' },
  driveLead: { ar: 'اختر خريطة وسُق كما تحب. لا فاحص ولا أخطاء.', en: 'Pick a map and drive as you like. No examiner, no faults.' },
  practiseLead: { ar: 'الفاحص يراقب وينبّهك على كل خطأ في وقته.', en: 'The examiner watches and points out each fault as it happens.' },
  testLead: { ar: 'مثل الاختبار الحقيقي: الساحة أولاً ثم الطريق. النتيجة في النهاية.', en: 'As at the real test: the yard first, then the road. The result at the end.' },
  startLesson: { ar: 'ابدأ', en: 'Start' },
  drive: { ar: 'انطلق', en: 'Go' },
  factsCity: { ar: '١٦ تقاطعاً · إشارات ودوّارات · حتى ٦٠ كم/س', en: '16 junctions · signals and roundabouts · up to 60 km/h' },
  factsHighway: { ar: 'حلقة ١٤ كم · ثلاث مسارات · ١٢٠ كم/س', en: '14 km loop · three lanes · 120 km/h' },
  factsTown: { ar: 'مدينة الاختبار · ٩ تقاطعات', en: 'The test town · 9 junctions' },
  factsYard: { ar: 'الساحة · أربعة تمارين', en: 'The yard · four exercises' },
  factsYardTest: { ar: 'الجزء الأول · أربعة تمارين', en: 'Part one · four exercises' },
  factsRoadTest: { ar: 'الجزء الثاني · جولة مع الفاحص', en: 'Part two · a drive with the examiner' },
  clutchUp: { ar: 'القابض: مرفوع', en: 'Clutch: up' },
  clutchBite: { ar: 'نقطة التعشيق', en: 'Biting point' },
  clutchAlmost: { ar: 'اضغط أكثر', en: 'Press further' },
  clutchDown: { ar: 'مضغوط: بدّل الغيار', en: 'Down: change gear' },
  menuHighwayNote: {
    ar: 'طريق سريع متصل يلف في الصحراء، بلا دوّارات ولا إشارات.',
    en: 'One unbroken motorway looping through the desert: no roundabouts, no lights.',
  },
  menuKicker: { ar: 'سلطنة عُمان · تدريب على القيادة', en: 'Sultanate of Oman · Driver training' },
  hbOnShort: { ar: 'مشدودة', en: 'On' },
  hbOffShort: { ar: 'محرّرة', en: 'Off' },
  mirrorLeftShort: { ar: 'يسار', en: 'Left' },
  mirrorCentreShort: { ar: 'وسط', en: 'Centre' },
  mirrorRightShort: { ar: 'يمين', en: 'Right' },
  gbManual: { ar: 'يدوي مع الكلتش', en: 'Manual with clutch' },
  gbAutoClutch: { ar: 'يدوي، الكلتش تلقائي', en: 'Manual, automatic clutch' },
  gbAutomatic: { ar: 'أوتوماتيك', en: 'Automatic' },
  gbNote_manual: {
    ar: 'كما في السيارة: اضغط الكلتش (Shift) ثم بدّل الغيار. الدروس تستعمل هذا دائماً.',
    en: 'As in the car: press the clutch (Shift), then change gear. Lessons always use this.',
  },
  gbNote_autoClutch: {
    ar: 'تبدّل الغيار بنفسك (E للأعلى، Q للأسفل) والكلتش يشتغل لحاله: يفصل ويوصل بنعومة ولا تطفي السيارة.',
    en: 'You change gear (E up, Q down); the clutch works itself, smoothly, and the engine never stalls.',
  },
  gbNote_automatic: {
    ar: 'اختر D (E) أو N أو R، والسيارة تبدّل الغيارات بنفسها.',
    en: 'Choose D (E), N or R; the car changes gear by itself.',
  },
  qAuto: { ar: 'تلقائي', en: 'Auto' },
  qLow: { ar: 'منخفضة', en: 'Low' },
  qMedium: { ar: 'متوسطة', en: 'Medium' },
  qHigh: { ar: 'عالية', en: 'High' },
  setReloadNote: { ar: 'تُطبَّق الجودة بعد إعادة التحميل.', en: 'Quality applies after a reload.' },
  setReload: { ar: 'إعادة التحميل الآن', en: 'Reload now' },
  setShowFps: { ar: 'إظهار عدد الإطارات في الثانية', en: 'Show frames per second' },
  setController: { ar: 'يد التحكم والمقود', en: 'Gamepad and steering wheel' },
  setPadFound: { ar: 'متصل', en: 'Connected' },
  setPadStandard: { ar: 'بالتخطيط القياسي', en: 'standard layout' },
  setPadLearned: { ar: 'مضبوط حسب تعليمك', en: 'set up as you taught it' },
  setPadNone: {
    ar: 'لا توجد يد تحكم. صِلها ثم اضغط أي زر فيها.',
    en: 'No controller found. Connect one, then press any of its buttons.',
  },
  setPadUnsupported: { ar: 'هذا المتصفح لا يدعم أيادي التحكم.', en: 'This browser does not support controllers.' },
  setLearn: { ar: 'علّم المقود والدواسات', en: 'Teach a wheel and pedals' },
  setForget: { ar: 'أعد التخطيط القياسي', en: 'Back to the standard layout' },
  learnSteer: { ar: 'أدر المقود إلى أقصى اليمين ثم أعده إلى الوسط', en: 'Turn the wheel fully right, then back to the centre' },
  learnGas: { ar: 'اضغط دواسة الوقود حتى النهاية ثم ارفع قدمك', en: 'Press the gas pedal all the way, then let it up' },
  learnBrake: { ar: 'اضغط دواسة الفرامل حتى النهاية ثم ارفع قدمك', en: 'Press the brake pedal all the way, then let it up' },
  learnClutch: { ar: 'اضغط دواسة القابض حتى النهاية ثم ارفع قدمك', en: 'Press the clutch pedal all the way, then let it up' },
  learnGear: { ar: 'ضع ذراع الغيار على الغيار {gear}', en: 'Put the gear lever in gear {gear}' },
  learnReverse: { ar: 'ضع ذراع الغيار على الخلفي (R)', en: 'Put the gear lever in reverse (R)' },
  learnNoClutch: { ar: 'لا توجد دواسة قابض', en: 'No clutch pedal' },
  learnNoShifter: { ar: 'لا يوجد ذراع غيار', en: 'No gear lever' },
  learnCancel: { ar: 'إلغاء', en: 'Cancel' },
  fpsLabel: { ar: 'إطار/ث', en: 'fps' },
  menu: { ar: 'القائمة', en: 'Menu' },
  menuLead: {
    ar: 'تعلّم أولاً، تدرّب، ثم ادخل الاختبار.',
    en: 'Learn first, practise, then take the test.',
  },
  menuStartHere: { ar: 'ابدأ من هنا', en: 'Start here' },
  menuLearn: { ar: 'تعلّم', en: 'Learn' },
  menuLearnIntro: {
    ar: 'دروس قصيرة بالترتيب: كل درس يقول لك ماذا تفعل خطوة بخطوة، مع تلميحات.',
    en: 'Short lessons in order: each tells you what to do, step by step, with hints.',
  },
  menuLessonsDone: { ar: 'أنهيت {n} من {total} دروس', en: '{n} of {total} lessons done' },
  menuNextLesson: { ar: 'الدرس التالي', en: 'Next lesson' },
  menuAllLessons: { ar: 'كل الدروس', en: 'All lessons' },
  menuPractise: { ar: 'تدرّب', en: 'Practise' },
  menuPractiseIntro: {
    ar: 'قُد على راحتك، بفاحص أو بدونه.',
    en: 'Drive at your own pace, with or without the examiner.',
  },
  practiseTown: { ar: 'تدريب في المدينة مع ملاحظات', en: 'Practise in town, with notes' },
  menuFreeNote: {
    ar: 'شوارع واسعة بخطّين، ومنطقة صناعية في الجنوب.',
    en: 'Wide two-lane streets, and an industrial estate to the south.',
  },
  menuTownNote: {
    ar: 'الفاحص يراقب ويخبرك بكل خطأ فوراً مع نصيحة.',
    en: 'The examiner watches and tells you each fault at once, with a tip.',
  },
  menuYardNote: {
    ar: 'الوقوف عند الخط، المرتفع، الاصطفاف الخلفي والموازي.',
    en: 'Stop line, hill start, reverse and parallel parking.',
  },
  menuTest: { ar: 'الاختبار', en: 'The test' },
  menuTestIntro: {
    ar: 'مثل الاختبار الحقيقي: الساحة أولاً ثم الطريق. الفاحص لا يخبرك بالأخطاء إلا في النهاية.',
    en: 'As in the real test: the yard first, then the road. The examiner tells you the faults only at the end.',
  },
  menuYardTestNote: { ar: 'أربعة تمارين في الساحة.', en: 'Four exercises in the yard.' },
  menuRoadTestNote: {
    ar: 'جولة في المدينة والفاحص يوجّهك عند كل تقاطع.',
    en: 'A drive round town, the examiner directing you at each junction.',
  },
  menuBack: { ar: 'رجوع', en: 'Back' },
  menuClose: { ar: 'متابعة القيادة الحرة', en: 'Carry on free driving' },
  menuUnofficial: {
    ar: 'للتدريب فقط: ليس اختباراً رسمياً، وقواعد الفاحص لم تُراجَع بعد مع الجهة المختصة.',
    en: 'For practice only: not an official test, and the examiner\'s rules have not yet been checked with the authorities.',
  },
  msgFreeHint: {
    ar: 'قيادة حرة: لا فاحص. شغّل المحرك وانطلق. القائمة ☰ فيها الدروس والاختبار.',
    en: 'Free drive: no examiner. Start the engine and go. The ☰ menu has the lessons and the test.',
  },
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
