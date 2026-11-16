// ===== SmartTable: สร้างข้อความ QR พร้อมเพย์ (มาตรฐาน EMVCo / Thai QR Payment) =====
// target = เบอร์มือถือ 10 หลัก / เลขบัตรประชาชนหรือเลขผู้เสียภาษี 13 หลัก / e-Wallet 15 หลัก
// amount = ยอดเงิน (ไม่ใส่ = ให้ลูกค้ากรอกเอง)
(function () {
  const f = (id, v) => id + String(v.length).padStart(2, '0') + v;

  function crc16(s) {                       // CRC-16/CCITT-FALSE
    let crc = 0xFFFF;
    for (let i = 0; i < s.length; i++) {
      crc ^= s.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  function payload(target, amount) {
    const t = String(target || '').replace(/\D/g, '');
    let acc;
    if (t.length >= 15) acc = f('03', t);                                   // e-Wallet
    else if (t.length >= 13) acc = f('02', t);                              // บัตรประชาชน / ผู้เสียภาษี
    else if (t.length === 10 && t[0] === '0') acc = f('01', ('0000000000000' + '66' + t.slice(1)).slice(-13));
    else return null;
    const amt = Number(amount);
    let p = f('00', '01') + f('01', amt > 0 ? '12' : '11')
          + f('29', f('00', 'A000000677010111') + acc)
          + f('58', 'TH') + f('53', '764')
          + (amt > 0 ? f('54', amt.toFixed(2)) : '')
          + '6304';
    return p + crc16(p);
  }

  window.STPromptPay = { payload, crc16 };
})();
