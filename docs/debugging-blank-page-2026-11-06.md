# Perbaikan startup dan render PeopleOS

Tanggal: 6 November 2026. Acuan awal: commit `52c674009f3bb000d83df38a968613ba47d46b32`.

## Kesimpulan diagnosis

Halaman `/exec` kosong dengan error pertama `SyntaxError: missing ) after argument list` konsisten dengan blok JavaScript inti yang gagal diparse. Deklarasi dalam blok yang gagal tidak dijalankan. Modul tambahan kemudian langsung mengakses `db`, `route`, dan `nav` serta menangkap `window.render` yang belum tersedia; inilah rantai yang dapat menghasilkan ReferenceError dan `prevRender8 is not a function`.

**Batas kepastian:** SyntaxError pertama dari deployment pengguna tidak berhasil direproduksi pada checkout awal. Sebelum perubahan, seluruh 28 script inline Index sudah lolos kompilasi dan halaman lokal tampil di Chromium tanpa pageerror. Nomor baris Console 1170/1236 tidak dapat dipetakan dengan pasti tanpa HTML/stack dari deployment yang gagal. Karena itu laporan ini tidak mengklaim menemukan atau membetulkan tanda kurung tertentu yang salah pada kode deployment tersebut.

Yang terbukti di sumber adalah ketergantungan startup yang tidak dijaga dan rantai wrapper render yang rapuh. Perubahan memperbaiki mekanisme tersebut, menyediakan diagnostik untuk kegagalan parsing, dan menambahkan tes yang menangkap regresi startup. Untuk memastikan akar SyntaxError pada layanan live, bandingkan Index dalam proyek Apps Script dan versi deployment `/exec` dengan sumber repository yang telah diuji. Jangan menambahkan variabel dummy atau mengganti routing untuk menghindari masalah.

`configured: false`, `configVersion: 0`, dan `branches: []` menunjukkan konfigurasi OPS belum tersimpan. Kondisi tersebut bukan SyntaxError dan tidak seharusnya mencegah halaman HR dibuka. Ini diuji dengan mock konfigurasi kosong; konfigurasi cabang tidak diisi atau diubah oleh perbaikan.

## Struktur yang diperiksa

- Backend sebenarnya bernama `Kode.gs`, bukan `Code.gs`.
- Backend preview khusus bernama `OpsBonusStandbyPreview.gs`; tidak ditemukan `OpsBonusStandbyPreview.html`.
- UI: `Index.html`, `OpsConsole.html`, `BonusPreview.html`.
- `appsscript.json` mempertahankan V8, timezone, scope OAuth dan pengaturan akses semula.
- `doGet` aktif ada di `Kode.gs`; teks `doGet`/`doPost` lain dalam Index adalah contoh kode dalam string, bukan handler server aktif.
- Referensi `Baraka_OneDrive_Sync_Vault.js` bersifat opsional dan file tersebut tidak ada di checkout. Pengujian 404 membuktikan ketiadaannya tidak mengosongkan halaman utama. Tidak dibuat Vault berisi data perusahaan.

## Perubahan sumber

Hanya `Index.html` yang diubah di antara file aplikasi. File tambahan: dua suite regresi dan laporan ini. Dokumen audit sebelumnya dipertahankan.

| Bagian Index setelah perubahan | Sebelum | Sesudah |
| --- | --- | --- |
| Baris 66–187, `BarakaRuntime` | Tidak ada diagnostik yang dimuat sebelum inti | Panel error memakai textContent, pencatatan Console, pemeriksaan kesiapan inti, dan lifecycle modul |
| Baris 110, dispatcher render | Extension menangkap renderer sebelumnya secara berantai | Satu renderer inti nyata dan daftar hook bernama; exception inti tetap dilaporkan dan diteruskan |
| Baris 132, `registerModule` | IIFE modul langsung dijalankan saat script ditemui | 25 modul didaftarkan dahulu, lalu diinisialisasi sesuai urutan dokumen pada DOMContentLoaded setelah inti siap |
| Baris 140, `addRenderHook` | 13 pembungkus `prevRender*`/`origRender` | Hook sebelum/sesudah render pada dispatcher yang sama; kegagalan extension dilaporkan tanpa menghentikan hook independen berikutnya |
| Baris 146, `start` | Modul tetap mengakses global walau inti gagal | Validasi renderer dan state asli; jika inti gagal, modul tidak dijalankan dan penyebab ditampilkan |
| Baris 2095, pendaftaran core | Tidak ada tanda bahwa deklarasi/state inti telah selesai | `setCore(window.render, () => ({ db, route, nav }))` dipanggil sesudah seluruh deklarasi/listener inti siap |
| Baris 4747, hook alat rekrutmen 8.0 | `prevRender8()` tanpa validasi renderer sebelumnya | `addRenderHook('recruitment-tools-8.0', ...)`; tidak lagi memanggil fungsi tangkapan yang dapat undefined |

Hook lainnya mempertahankan enhancer: toolbar, workflow HR, audit teknis, backup, execution center, smart dock/minimization, crop dan pengaturan tanda tangan, Gmail, pembaruan alamat, form meeting, dan kandidat Hold. Hook alamat tetap dijalankan sebelum render, sesuai urutan fungsional sebelumnya. Tidak ada modul HR yang dihapus.

State `db`, `route`, dan `nav` tetap memakai deklarasi dan scope asli. Tidak dibuat salinan global palsu, database baru, atau nilai fallback untuk menutupi kegagalan inti. Error extension dipisahkan secara eksplisit dari error inti, ditampilkan beserta nama modul, dan tetap dicatat ke Console. Guard ini bukan bukti bahwa fitur extension yang gagal sudah berfungsi.

## Hasil validasi

### Node, tanpa dependency tambahan

```sh
node tests/startup.test.cjs
node tests/bonus-preview.test.cjs
```

- **7/7 tes startup/routing lulus.** Seluruh script inline Index/OpsConsole/BonusPreview dan dua file `.gs` dikompilasi; urutan modul, tidak adanya state dummy, hook gagal, error inti, modul gagal, routing serta penolakan akun yang tidak diizinkan diuji.
- **42/42 tes bonus lama lulus**, tidak ada yang dilewati. Parser, mapping, perbandingan, slot/formula/merge, read-only endpoint mock dan UI preview tetap melewati suite yang sama.
- Total script inline Index sekarang 29, termasuk bootstrap baru. String contoh kode server bukan deployment yang dijalankan.

### Chromium / Playwright

```sh
node --test tests/startup.browser.cjs
```

Suite opsional memerlukan Playwright dan Chromium yang sudah tersedia pada lingkungan ini. Untuk mesin lain, gunakan instalasi tooling development yang sesuai; lokasi Chromium dapat dipilih dengan `CHROMIUM_PATH`. Tidak menambahkan package/lockfile ke proyek.

**6/6 tes browser lulus:**

1. Startup normal dan 19 rute: dashboard, employees, recruitment, tasks, attendance, leaves, payroll, claims, cases, assets, reviews, calendar, messages, documents, reports, settings, activity, help, ops-integration. Tiap rute menghasilkan konten, tanpa pageerror atau panel kegagalan. Uji juga tampilan dashboard pada viewport mobile.
2. SyntaxError sengaja disuntikkan ke script inti pada respons server pengujian: panel inisialisasi gagal muncul, tidak ada error turunan `db`/`route`/`nav` atau pemanggilan `prevRender` undefined. Script inti rusak memang tidak dirender sebagai aplikasi sehat.
3. Halaman berjalan dalam iframe sandbox dengan izin scripts/same-origin/storage; tombol navigasi rekrutmen benar-benar diklik dan konten berubah.
4. SyntaxError sengaja disuntikkan pada extension 8.0: modul teridentifikasi gagal didaftarkan, sementara inti dan rute OPS tetap tampil tanpa ReferenceError/TypeError turunan.
5. Hook render sengaja dibuat gagal: error asli tampil, hook sesudahnya berjalan, navigasi rekrutmen dan dokumen tetap menghasilkan halaman.
6. UI `?ops=1` dan `?bonus=1` dibuka dengan bridge Google mock dan konfigurasi kosong; tidak ada pageerror, tombol preview terlihat dan penulisan tetap dinonaktifkan.

Pada kasus normal tidak ada JavaScript pageerror. Pada kasus fault injection, SyntaxError sengaja dipertahankan sebagai bukti diagnostik bekerja; kasus tersebut bukan klaim bahwa script invalid berhasil diparse. Ketiadaan file Vault menghasilkan HTTP 404 yang diharapkan dan ditangani loader opsional.

Jumlah keseluruhan: **55 tes lulus, 0 gagal, 0 dilewati**. `git diff --check` juga bersih.

## Batas pengujian dan perlindungan data

Pengujian browser memakai server lokal dan context sementara. Permintaan keluar diblokir dalam suite; backend menggunakan mock. Tidak mengakses atau menulis workbook/folder perusahaan, mengirim Gmail/WA, menyinkronkan cloud, atau mengubah Script Properties.

`Kode.gs`, `OpsBonusStandbyPreview.gs`, `BonusPreview.html`, `OpsConsole.html`, manifest, ID resource, konfigurasi cabang, struktur data, perhitungan bonus/absensi dan formula Sheets tidak diubah. Suite bonus tidak membuktikan commit lama atau XLSX absensi bekerja pada data perusahaan; keduanya tidak dijalankan live. Tampilan halaman tiap modul diuji, bukan seluruh operasi bisnis pada setiap modul.

Routing backend diuji melalui doGet asli dalam VM. Browser membuka halaman HTML yang sama melalui pemetaan server lokal; ini bukan hasil deployment HtmlService Google. Keberhasilan backend live, otorisasi deployment, sumber SyntaxError awal dan akses Sheets/Drive aktual tetap memerlukan uji di Apps Script.

## Aktivasi pada Google Apps Script

1. Simpan salinan source Apps Script yang sekarang untuk perbandingan. Pastikan proyek yang dibuka adalah proyek milik URL `/exec` yang bermasalah.
2. Bandingkan lalu terapkan **seluruh isi Index.html hasil perbaikan** ke file HTML `Index` dalam proyek tersebut. Jangan menggabungkan potongan dari versi yang berbeda. Tidak perlu mengganti backend, manifest, Script Properties atau ID resource untuk perubahan ini.
3. Simpan dan uji melalui **Test deployments / `/dev`** sebagai akun yang berhak. Buka halaman utama, `?ops=1`, `?bonus=1`. Periksa Console dan panel diagnostik; catat error pertama lengkap jika masih muncul.
4. Periksa navigasi HR, Kanban, dokumen/tanda tangan, meeting, Gmail panel, Hold kandidat dan OPS. Pengujian pengiriman/tulisan data harus terpisah dan memakai salinan data yang disetujui.
5. Untuk mengaktifkan perubahan pada `/exec`, buka **Deploy → Manage deployments → Edit → Version: New version → Deploy** pada deployment yang sama agar URL tetap. Menyimpan source saja tidak memperbarui versi `/exec` yang dikunci ke versi lama.
6. Muat ulang halaman dan ulangi tiga URL. Jangan menghapus localStorage/data pengguna sebagai cara memperbaiki error parsing.

Jika `/dev` dari source ini sehat tetapi `/exec` masih menunjukkan SyntaxError lama, pastikan deployment/version/proyek yang dipilih benar dan periksa response HTML/stack versi tersebut. Jika kedua URL gagal, gunakan error pertama serta nama modul dari panel baru untuk diagnosis lanjutan. **Perbaikan SyntaxError spesifik deployment belum dapat dinyatakan selesai sebelum pembuktian ini.**

Tidak dilakukan deployment, publikasi environment, commit Git, push, force push, reset atau penghapusan file dalam pekerjaan ini.
