# Verifikasi lanjutan source dan deployment PeopleOS

Tanggal: 6 November 2026. Baseline repository: `52c674009f3bb000d83df38a968613ba47d46b32`.

SHA-256 `Index.html` yang diperiksa: `f57ee98903b674c4163867f5e57655ddc162726472e57f17f8728928544ad251`.

## Keputusan

| Pertanyaan | Hasil berdasarkan bukti |
| --- | --- |
| Apakah masalah benar-benar diperbaiki? | Masalah dependensi startup dan chaining renderer diperbaiki serta teruji lokal. Masalah halaman kosong pada deployment Google `/exec` belum dapat dinyatakan selesai, karena response/source deployment yang gagal belum dapat diperiksa. |
| Apakah source siap diterapkan? | Siap dipindahkan ke proyek Apps Script pengujian dan diverifikasi melalui test deployment `/dev`. Belum merupakan persetujuan produksi atau bukti bahwa semua operasi live berjalan. |
| Apakah deployment lama penyebabnya? | Mungkin, tetapi belum terbukti. Source awal maupun terbaru tampil normal secara lokal. Nomor versi aktif dan isi response `/exec` belum tersedia. Jangan menyimpulkan versi lama hanya dari screenshot atau konfigurasi OPS kosong. |
| Apakah dilakukan perubahan aplikasi tambahan? | Tidak. Putaran ini memeriksa source yang sudah diperbaiki, menjalankan ulang tes, melakukan perbandingan browser, dan menambahkan laporan ini. |
| Apakah dilakukan deployment/publikasi? | Tidak. Tidak ada commit, push, reset, perubahan konfigurasi cabang, database perusahaan, atau formula Sheets. |

## 1. Integritas perubahan terhadap source awal

Perbandingan menggunakan `git show HEAD:Index.html` dan file kerja terbaru.

- Source awal memiliki 28 script inline; terbaru memiliki 29 karena bootstrap diagnostik ditambahkan.
- Seluruh 21 blok CSS lama identik secara byte.
- Tidak ada fungsi bernama lama yang terhapus berdasarkan inventaris deklarasi fungsi.
- Setelah perubahan mekanis registrasi modul, pendaftaran core, dan hook render dikembalikan secara in-memory, 26 dari 28 script sama persis dengan baseline. Dua script lain hanya memiliki tambahan satu spasi antara `function()` dan `{` pada wrapper yang direkonstruksi. Tidak ada perbedaan isi aturan bisnis pada pembandingan tersebut.
- Seluruh 25 module closure tetap ada, dalam urutan registrasi yang sama.
- Perubahan perilaku yang disengaja adalah waktu inisialisasi extension sesudah core siap pada DOMContentLoaded, dan isolasi kegagalan hook extension. Ini tidak sama dengan klaim bahwa perilaku startup identik dalam keadaan error.
- Backend `Kode.gs`, `OpsBonusStandbyPreview.gs`, UI `BonusPreview.html`/`OpsConsole.html`, manifest, dan suite bonus lama tidak berubah terhadap baseline Git.
- `git diff --check` bersih. Dokumen audit sebelumnya tetap dipertahankan.

Tidak ada source aplikasi baru yang diedit selama verifikasi lanjutan ini. Tidak ditemukan alasan teruji untuk menambah perubahan aplikasi lain.

## 2. Hubungan dengan error Console

| Error | Pemeriksaan dan status |
| --- | --- |
| `missing ) after argument list` | Semua script source terkini lolos kompilasi Node dan eksekusi startup Chromium. Baseline sebelum perbaikan juga sudah valid. Dengan demikian tanda kurung spesifik pada deployment belum ditemukan atau dibetulkan; perlu response/stack asli dari deployment yang gagal. |
| `db is not defined` | `db` tetap deklarasi asli. Modul tidak berjalan sebelum core mendaftarkan pembaca state sebenarnya. Pada simulasi script inti rusak, error asli terlihat dan tidak muncul error dependensi ini. |
| `route is not defined` | Scope asli dipertahankan; kesiapan core diperiksa sebelum extension dijalankan. Tidak dibuat route dummy. |
| `nav is not defined` | Navigasi asli dipertahankan dan diuji sebagai array pada kesiapan core. Navigasi HR tidak bergantung pada `ops=1`. |
| `prevRender8 is not a function` | Pemanggilan `prevRender8()` sudah diganti dengan hook bernama pada dispatcher yang menyimpan renderer inti nyata. Renderer tidak lagi diperoleh dengan menangkap wrapper extension sebelumnya. |

**Perbedaan penting:** containment error bukan perbaikan parser JavaScript. Bila script sengaja dirusak, SyntaxError tetap tercatat di browser dan panel diagnostik; runtime tidak mencoba menganggapnya valid. Core yang gagal tidak diberi data dummy dan tidak diklaim berhasil. Error renderer inti dilaporkan serta diteruskan; error extension ditampilkan dan dicatat, sementara extension independen boleh berjalan.

Karena itu, hasil 55 tes tidak boleh digunakan sebagai bukti bahwa SyntaxError pada response Google `/exec` sudah hilang. Bukti yang tersedia baru menunjukkan source lokal sehat dan kegagalan dependensi ditangani secara eksplisit.

## 3. Pengujian ulang

Perintah yang benar-benar dijalankan:

```sh
node tests/startup.test.cjs
node tests/bonus-preview.test.cjs
node --test tests/startup.browser.cjs
```

| Kelompok | Hasil |
| --- | --- |
| Startup, sintaks, state, renderer, routing doGet dan otorisasi mock | 7 lulus, 0 gagal, 0 dilewati |
| Bonus preview: parser, mapping, merge/formula, slot, endpoint dan UI mock | 42 lulus, 0 gagal, 0 dilewati |
| Chromium: 19 rute, mobile, iframe sandbox, fault injection dan UI OPS/bonus | 6 lulus, 0 gagal, 0 dilewati |
| Total suite yang sudah tersedia | **55 lulus, 0 gagal, 0 dilewati** |

Tes dengan fault injection sengaja menghasilkan SyntaxError pada response server pengujian. Tes dinyatakan lulus karena error itu terdeteksi tanpa rantai ReferenceError/TypeError turunan, bukan karena script invalid berhasil dijalankan.

Selain suite tersebut, dilakukan pembandingan baseline dan source terbaru di dua browser context terpisah, memakai tanggal dan UUID deterministik, server lokal, serta pemblokiran permintaan keluar:

- Teks hasil render **19 rute identik**: dashboard, employees, recruitment, tasks, attendance, leaves, payroll, claims, cases, assets, reviews, calendar, messages, documents, reports, settings, activity, help, ops-integration.
- Isi **10 form identik**: employee, candidate, task, attendance, leave, claim, case, asset, review, payroll. Ini membuktikan pembukaan form, bukan seluruh proses submit setiap form.
- Hasil fungsi pada data sintetis identik untuk ringkasan absensi, draft payroll, konversi kandidat Offering menjadi karyawan, tugas onboarding, hari kerja, agenda kalender, teks WA, dan HTML surat resmi.
- Tombol Hold kandidat benar-benar diklik pada kedua versi; tahap menjadi Pending / Hold, kandidat tidak masuk agenda, lalu tombol restore mengembalikannya ke Screening. Hasil record kandidat kedua versi identik.
- Tombol Gmail compose/background tetap ada. Tidak ada email dikirim.
- Tidak ada JavaScript pageerror selama pembandingan normal kedua versi.

Pengujian ini memakai data demo pada browser context sementara, tidak mengubah database perusahaan atau file repository. Tidak membuktikan setiap kemungkinan input dan operasi bisnis, pengiriman email, atau integrasi live Google.

## 4. Routing yang diperiksa

`doGet(e)` pada `Kode.gs` tetap memeriksa otorisasi dan memilih `Index` secara default, `OpsConsole` untuk `ops=1`, serta `BonusPreview` untuk `bonus=1`.

| URL/alur | Bukti lokal | Status Google live |
| --- | --- | --- |
| `/exec` tanpa parameter | Main PeopleOS tampil; 19 rute sehat | Belum terverifikasi |
| `/exec?ops=1` | doGet asli diuji di VM; HTML OpsConsole berjalan dengan bridge mock | Belum terverifikasi |
| `/exec?bonus=1` | doGet asli diuji di VM; UI preview tetap read-only dengan bridge mock | Belum terverifikasi |
| `/dev` | Path lokal menampilkan main PeopleOS; doGet tidak memerlukan parameter ops | Test deployment Google belum diakses |

Path `/exec`, `/dev`, dan `/exec?ops=0` juga dibuka pada server pengujian dengan bridge backend yang mengembalikan konfigurasi kosong. Ketiganya menginisialisasi PeopleOS tanpa panel kegagalan. Pemetaan path lokal ini bukan emulasi lengkap layanan Apps Script atau pembuktian versi deployment Google.

## 5. Mengapa versi deployment aktif belum bisa dipastikan

Pemeriksaan runtime menunjukkan kebijakan jaringan terbatas. Host Apps Script dan Apps Script API tidak termasuk host Google yang tersedia pada daftar efektif; yang tercantum hanya `dl.google.com`. Tidak dilakukan perubahan allowlist atau upaya melewati proxy.

Pemeriksaan read-only `HEAD https://script.google.com/` gagal sebelum menerima respons HTTP:

```text
curl: (7) Failed to connect to proxy port 8080 after 0 ms: Could not connect to server
HTTP status: 000
```

Tidak ada konektor Apps Script atau file `.clasp.json` yang memberikan metadata script/deployment dalam checkout. Ada variabel `GOOGLE_APPLICATION_CREDENTIALS` di mesin; hanya keberadaannya yang diperiksa, bukan nilainya. Keberadaan variabel tersebut tidak membuktikan hak akses proyek Apps Script ini. Tidak dilakukan pembacaan file kredensial, login, atau permintaan token.

Akibatnya, nomor versi deployment aktif, tanggal deployment, source editor Google terkini, dan response HTML `/exec` yang bermasalah belum bisa diperoleh. Tidak ada bukti bahwa deployment lama pasti penyebabnya, maupun bukti bahwa source terbaru sudah terpasang di proyek Google.

## 6. Source repository, editor Google, `/dev`, dan `/exec`

Empat hal berikut berbeda:

1. **File lokal repository:** perubahan hanya berada di workspace sampai dipindahkan melalui alur yang benar.
2. **Source pada editor Apps Script:** harus sesuai dengan file lokal; penyimpanan file lokal atau publikasi cloud environment tidak otomatis menyinkronkannya.
3. **Test deployment `/dev`:** memakai source terbaru yang disimpan pada proyek yang benar, dengan akses pengguna yang berhak. Gunakan URL yang diberikan menu Test deployments; jangan menganggap penggantian teks `/exec` menjadi `/dev` selalu menunjuk test deployment yang tepat.
4. **Versioned deployment `/exec`:** memakai versi yang dipilih untuk deployment tersebut. Menyimpan perubahan di editor tidak otomatis memindahkan deployment ke versi baru.

Publikasi environment Codex yang pernah dilakukan sebelumnya adalah publikasi snapshot lingkungan kerja, bukan deployment Web App Google Apps Script.

## 7. Langkah aktivasi yang tepat

1. Buka proyek Apps Script yang benar untuk URL Web App yang bermasalah. Catat deployment ID dan nomor versi aktif melalui **Deploy → Manage deployments** tanpa mengeditnya terlebih dahulu.
2. Bandingkan file `Index` dalam editor dengan `Index.html` yang diuji. Marker source terbaru antara lain `window.BarakaRuntime`, `BarakaRuntime.setCore`, dan `data-baraka-extension`. Marker membantu mengenali source, tetapi bukan pengganti pembandingan lengkap atau bukti bahwa `/exec` memakai versi tersebut.
3. Setelah penerapan source disetujui, pindahkan seluruh `Index.html` ke file HTML `Index` dan simpan. Jangan mencampurkan potongan dari versi berbeda. Backend/manifest/Script Properties tidak perlu diganti untuk patch ini.
4. Buka **Deploy → Test deployments**, salin URL test yang disediakan, dan uji `/dev` sebagai akun yang berhak. Periksa main PeopleOS tanpa parameter, OpsConsole, dan BonusPreview. Periksa error pertama di Console dan panel runtime, serta navigasi modul terdampak.
5. Jika `/dev` sehat tetapi `/exec` masih memakai kode lama, lakukan aktivasi produksi **hanya setelah persetujuan pengguna**: **Deploy → Manage deployments → Edit → New version → Deploy** pada deployment yang sama. Ini mempertahankan URL deployment. Jangan memperluas akses atau mengubah akun eksekusi tanpa kebutuhan terpisah.
6. Muat ulang `/exec` dan dua parameter halaman; verifikasi bahwa versi dan respons yang tampil memang source terbaru. Jangan menghapus localStorage atau mengisi konfigurasi cabang untuk mencoba memperbaiki SyntaxError.

Belum ada satu pun langkah yang menulis source Google, mengubah deployment, atau memublikasikan versi yang dilakukan dalam verifikasi ini.

## 8. Risiko tersisa

- SyntaxError deployment asli belum direproduksi; bisa berasal dari versi berbeda, proyek berbeda, atau salinan source yang tidak lengkap. Belum ada dasar memilih salah satunya sebagai penyebab pasti.
- HTMLService, kebijakan browser, dan otorisasi Google nyata belum diuji. Iframe lokal menguji sebagian karakteristik browser, bukan seluruh transformasi layanan Google.
- Tes memakai data sintetis dan mock, bukan workbook atau file perusahaan. Penulisan absensi/bonus, pengiriman Gmail/WA, cloud snapshot dan konfigurasi cabang live belum dibuktikan.
- Lifecycle dan penanganan kegagalan memang berubah. Jalur sehat yang diuji setara, tetapi ini tidak menjamin kesetaraan setiap input atau perilaku modul yang sebelumnya gagal.
- Panel error membuat kegagalan terlihat; fitur yang error tetap harus dianggap gagal, bukan berhasil hanya karena halaman lain tampil.

**Status akhir:** source lokal lolos pemeriksaan dan siap untuk uji Apps Script `/dev`; penyelesaian masalah produksi masih menunggu bukti dari deployment yang benar. Tidak dilakukan deployment atau publikasi tanpa persetujuan.
