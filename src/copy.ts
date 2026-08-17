import type { Locale } from './domain/models';

const copy = {
  th: {
    start: 'แตะเพื่อเริ่มต้น', eventReady: 'พร้อมใช้งานสำหรับอีเวนต์',
    redeemReady: 'ใช้ Redeem Code เพื่อเริ่ม', chooseLayout: 'เลือกรูปแบบภาพ',
    capture: 'ถ่ายภาพ', nextShot: 'ภาพถัดไป', chooseFrame: 'เลือกกรอบและโทนภาพ',
    review: 'ตรวจสอบก่อนพิมพ์', retake: 'ถ่ายใหม่ทั้งหมด',
    confirmPrint: 'ยืนยันและพิมพ์ 2 ใบ', printing: 'กำลังพิมพ์',
    complete: 'เรียบร้อยแล้ว', finish: 'จบการใช้งาน', codeLabel: 'กรอก Redeem Code',
    codeHint: 'ตัวอักษร 2 ตัว และตัวเลข 4 ตัว', continue: 'ดำเนินการต่อ',
    idleTitle: 'ยังใช้งานอยู่ไหม?', idleBody: 'แตะหน้าจอเพื่อใช้งานต่อ ระบบจะล้างข้อมูลเมื่อหมดเวลา',
    color: 'สี', mono: 'ขาวดำ',
  },
  en: {
    start: 'Tap to start', eventReady: 'Ready for this event',
    redeemReady: 'Use a redeem code to start', chooseLayout: 'Choose a layout',
    capture: 'Take photo', nextShot: 'Next shot', chooseFrame: 'Choose frame and tone',
    review: 'Review before printing', retake: 'Retake all',
    confirmPrint: 'Confirm and print 2 copies', printing: 'Printing',
    complete: 'All done', finish: 'Finish session', codeLabel: 'Enter redeem code',
    codeHint: '2 letters followed by 4 digits', continue: 'Continue',
    idleTitle: 'Are you still there?',
    idleBody: 'Tap the screen to continue. Session data will be cleared when time runs out.',
    color: 'Color', mono: 'Black & white',
  },
} as const;

export type CopyKey = keyof (typeof copy)['th'];

export function t(locale: Locale, key: CopyKey): string {
  return copy[locale][key];
}
