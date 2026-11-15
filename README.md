# SmartTable · ขั้นที่ 1 ระบบล็อกอิน

แอปสั่งอาหารด้วยการสแกน QR ที่โต๊ะ · หน้าเว็บอยู่บน GitHub Pages · หลังบ้านใช้ Supabase

## ไฟล์ในชุดนี้
```
index.html          หน้า เข้าสู่ระบบ / สมัครสมาชิก / ลืมรหัสผ่าน
reset.html          หน้าตั้งรหัสผ่านใหม่ (เปิดจากลิงก์ในอีเมล)
home.html           หน้าหลักหลังล็อกอิน (ไว้ทดสอบ)
css/st-style.css    หน้าตา
js/st-config.js     ← ต้องแก้: ใส่ URL และ key ของ Supabase
js/st-auth.js       ตัวช่วยร่วม (เชื่อม Supabase, ข้อความผิดพลาดภาษาไทย)
js/st-login.js / st-reset.js / st-home.js   โค้ดของแต่ละหน้า
sql/st-01-auth.sql  ตาราง st_profiles + RLS + RPC (รันซ้ำได้)
```

---

## ขั้นที่ 1 · สร้างโปรเจกต์ Supabase ใหม่
1. เข้า https://supabase.com/dashboard แล้วกด **New project**
2. ตั้งชื่อ `SmartTable` · Region เลือก **Southeast Asia (Singapore)**
3. ตั้ง Database Password แล้ว**จดเก็บไว้** (ต้องใช้ตอนย้ายข้อมูล)
4. กด Create แล้วรอ 1–2 นาที

## ขั้นที่ 2 · รัน SQL
1. เมนูซ้าย **SQL Editor** → **New query**
2. เปิดไฟล์ `sql/st-01-auth.sql` ด้วย Notepad → กด `Ctrl+A` แล้ว `Ctrl+C`
3. วางในช่อง SQL (`Ctrl+V`) แล้วกด **Run**
4. ต้องขึ้น `Success. No rows returned` (ถ้าเห็นคำเตือนสีเหลือง เช่น "already exists, skipping" ไม่เป็นไร)
5. ตรวจ: เมนู **Table Editor** ต้องเห็นตาราง `st_profiles` และ `st_schema_log` (ห้ามสร้างหรือแก้ตารางในหน้านี้เอง)

## ขั้นที่ 3 · ใส่ key ในไฟล์ตั้งค่า
1. Supabase → **Project Settings** (รูปเฟือง) → **API Keys** / **Data API**
2. คัดลอก **Project URL** และ **Publishable key** (`sb_publishable_...`) หรือ **anon public** key
3. เปิด `js/st-config.js` ด้วย Notepad แล้ววางแทน `YOUR-...` ทั้ง 2 จุด แล้วบันทึก
4. ⚠️ ห้ามใช้ **service_role / secret** key เด็ดขาด

## ขั้นที่ 4 · ขึ้น GitHub Pages
1. เข้า https://github.com/new → Repository name: `smarttable` → เลือก **Public** → **Create repository**
2. กดลิงก์ **uploading an existing file**
3. เปิดโฟลเดอร์ `smarttable` ใน File Explorer → เลือกทุกอย่างข้างใน (`Ctrl+A`) แล้วลากไปวางในหน้าเว็บ
   (ต้องลากโฟลเดอร์ `css` `js` `sql` ไปด้วย ไม่ใช่ลากโฟลเดอร์ `smarttable` ทั้งก้อน)
4. กด **Commit changes**
5. **Settings** → **Pages** → Source: *Deploy from a branch* → Branch: `main` / `(root)` → **Save**
6. รอ 1–2 นาที เว็บจะอยู่ที่ `https://bossrachun9696-stack.github.io/smarttable/`

## ขั้นที่ 5 · บอก Supabase ว่าเว็บเราอยู่ที่ไหน (สำคัญมาก ไม่งั้นลิงก์ในอีเมลใช้ไม่ได้)
Supabase → **Authentication** → **URL Configuration**
- **Site URL**: `https://bossrachun9696-stack.github.io/smarttable/`
- **Redirect URLs** → Add URL: `https://bossrachun9696-stack.github.io/smarttable/**`
- กด Save

## ขั้นที่ 6 · (แนะนำ) เปลี่ยนอีเมลเป็นภาษาไทย
Authentication → **Emails** (Email Templates)
- **Confirm signup** หัวข้อ: `ยืนยันอีเมลของคุณ` · เนื้อหา:
  ```html
  <h2>ยืนยันอีเมล</h2>
  <p>กดลิงก์ด้านล่างเพื่อยืนยันอีเมลและเริ่มใช้งาน</p>
  <p><a href="{{ .ConfirmationURL }}">ยืนยันอีเมล</a></p>
  ```
- **Reset password** หัวข้อ: `ตั้งรหัสผ่านใหม่` · เนื้อหา:
  ```html
  <h2>ตั้งรหัสผ่านใหม่</h2>
  <p>กดลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ ถ้าคุณไม่ได้ขอ ไม่ต้องทำอะไร</p>
  <p><a href="{{ .ConfirmationURL }}">ตั้งรหัสผ่านใหม่</a></p>
  ```
  (ไม่ใส่ชื่อแอปในอีเมล เพราะหลังย้ายไปรวมกับ DarkChat จะใช้แม่แบบอีเมลชุดเดียวกัน)

## ขั้นที่ 7 · ทดสอบบน iPhone
1. เปิด Safari ไปที่ลิงก์ GitHub Pages ของคุณ
2. แท็บ **สมัครสมาชิก** → กรอกชื่อ อีเมล รหัสผ่าน → ต้องขึ้นข้อความสีเขียวว่าส่งลิงก์แล้ว
3. เปิดแอป Mail → กดลิงก์ยืนยัน → ต้องเข้าหน้า "สวัสดี ชื่อของคุณ"
4. ลองแก้ชื่อแล้วกดบันทึก → ออกจากระบบ → เข้าสู่ระบบใหม่
5. ลอง **ลืมรหัสผ่าน** → กดลิงก์ในอีเมล → ตั้งรหัสใหม่ → เข้าสู่ระบบด้วยรหัสใหม่
6. Supabase → Table Editor → `st_profiles` ต้องเห็นแถวของคุณพร้อมอีเมล

## แก้ปัญหา
| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| ขึ้น "ยังไม่ได้ใส่ Project URL และ key" | แก้ `js/st-config.js` แล้วอัปโหลดใหม่ |
| ขึ้น "ยังไม่ได้รันไฟล์ SQL" | ทำขั้นที่ 2 |
| กดลิงก์ในอีเมลแล้วไปหน้า localhost หรือหน้าผิด | ทำขั้นที่ 5 แล้วขอลิงก์ใหม่ |
| "ส่งอีเมลบ่อยเกินไป" | อีเมลฟรีของ Supabase ส่งได้ไม่กี่ฉบับต่อชั่วโมง รอสักพัก (ใช้จริงควรตั้ง SMTP เอง) |
| แก้ไฟล์แล้วหน้าเว็บไม่เปลี่ยน | รอ 1–2 นาที แล้วรีเฟรช หรือเปิดใน Private tab |
