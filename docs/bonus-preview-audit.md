# Audit Preview Bonus Standby (READ ONLY)

## Kebijakan B–P dan Q–R setelah reset pusat

Preview tetap READ ONLY dan tidak menyediakan endpoint/tombol penulisan baru. Semua alamat/nilai yang dihasilkan adalah **rencana**, bukan instruksi yang sudah dijalankan. Aktifnya pengujian lokal tidak mengaktifkan impor; penulisan memerlukan pengujian Apps Script dan persetujuan pengguna dalam pekerjaan berikutnya.

| Kondisi | Hasil preview |
| --- | --- |
| Kedua baris B:P kosong tanpa formula, Q:R masih lama | Slot kosong/reset, boleh direncanakan untuk resi baru. Pencarian dimulai dari slot kosong paling awal, termasuk lubang sebelum resi yang masih ada. |
| Nomor resi sudah ada | Masuk daftar dilewati pada B:P; tidak ada rencana pengisian atau penggantian B:P, termasuk sel yang kosong. |
| Perbedaan penting B:P selain tanggal berangkat | Konflik per field, tanpa perubahan data utama. Q:R tetap boleh direncanakan untuk resi dengan identitas unik dan tanpa rumus Q:R. |
| Tanggal berangkat lama berbeda/tidak dikenali | Informasi terpisah, nilai C tujuan dipertahankan; bukan alasan menimpa tanggal. |
| Status/cabang berbeda | Daftar rencana Q:R memuat alamat/merge, nilai lama dan nilai terbaru. Tidak dihitung sebagai konflik B:P. |
| Q:R sama persis dengan sumber | Tidak ada rencana penulisan berulang. |
| B:P berisi nol, whitespace atau formula (termasuk `=""`) | Bukan slot kosong. Data/formula tanpa kunci resi dilaporkan sebagai slot dilindungi. |
| Nomor resi ganda atau berupa formula | Tidak membuat resi baru dan tidak merencanakan Q:R untuk identitas tersebut. |
| Q:R berisi formula | Rencana Q:R diblokir untuk resi itu. Untuk resi baru, rencana B:P juga tidak dikeluarkan agar tidak ada rencana parsial. |

Nomor/formula A selalu dipertahankan; nomor Datot tidak digunakan untuk menggantinya. Tanpa merge, E berada pada baris atas, field B:P lain dan R pada baris bawah, Q pada kedua baris. Dengan merge vertikal dalam satu pasangan, setiap sel ditujukan ke anchor yang dilaporkan Sheets. Q yang digabung menerima gabungan status atas dan bawah dengan pemisah baris; Q terpisah memiliki dua rencana sel. R ditujukan sekali ke anchor merge atau baris bawah bila tidak digabung. Tidak ada rencana unmerge, merge ulang, format, penomoran, penghapusan baris atau perubahan S:Z. Tab dengan lebih dari 1500 pasangan dihentikan secara eksplisit agar pembacaan sebagian tidak memungkinkan duplikasi resi di luar cakupan.

Laporan menambahkan `skipped`, `qrUpdates`, `information`, `slotIssues`, serta daftar alamat/nilai B:P untuk setiap `plannedRows[].mainChanges`. `summary.existingDifferent` menghitung resi unik yang memiliki konflik, sedangkan resi dilewati dapat sekaligus memiliki konflik dan rencana Q:R. `existingSame` tetap berarti seluruh nilai yang dibandingkan sama setelah normalisasi, bukan sekadar nomor resi ditemukan. Tiap daftar dibatasi 80 entri pada respons; hitungan ringkasan memakai hasil lengkap.

## Hubungan file

| File | Peran |
| --- | --- |
| `Kode.gs` | Backend bersama: `doGet`, otorisasi, konfigurasi Script Properties, parser OPS/absensi, preview dan commit integrasi lama. `doGet` menyajikan Index secara default, OpsConsole untuk `?ops=1`, BonusPreview untuk `?bonus=1`, serta diagnostik untuk `?diagnostik=1`. |
| `Index.html` | Aplikasi utama PeopleOS, penyimpanan browser, modul HR dan panel integrasi OPS. Panel integrasi lama memanggil endpoint konfigurasi/preview/commit milik Kode.gs. |
| `OpsConsole.html` | Pemeriksaan koneksi/cabang melalui `getOpsBootstrap`; tidak melakukan sinkronisasi. |
| `OpsBonusStandbyPreview.gs` | Endpoint preview khusus 014PTK: membaca Datot HTML berekstensi .xls, memvalidasi periode/cabang, memeriksa tab tanggal dan pasangan baris, serta menghasilkan laporan tanpa penulisan. Memakai `assertAuthorized_` dan `loadConfig_` dari Kode.gs. |
| `BonusPreview.html` | Memanggil bootstrap dan `previewBonusStandbyPontianakBarat` via `google.script.run`; menampilkan ringkasan, rencana, konflik dan diagnostik. Tidak memiliki tombol impor. |
| `appsscript.json` | Apps Script V8, zona waktu Asia/Jakarta, scope Drive/Sheets/email dan akses webapp MYSELF. Scope lama mencakup tulis karena integrasi lama masih memerlukannya; patch tidak mengubah manifest maupun mengaktifkan endpoint commit. |

## Temuan dan batas pembuktian

Pembanding sebelumnya selalu membaca B:R dari baris bawah (6, 8, 10, ...), sementara nomor resi E dibaca dari baris atas (5, 7, 9, ...). Untuk merge vertikal seperti B5:B6, `getValues()` mengembalikan tanggal hanya di B5; B6 kosong. Ini menghasilkan konflik tanggal/teks/angka walaupun anchor berisi nilai yang benar. Pemeriksaan lama tidak pernah membaca `getMergedRanges()`.

Selain itu, tanggal tidak dikenali dapat berubah menjadi string kosong, angka kosong dapat dianggap nol, dan tanggal teks memakai tampilan sebelum nilai mentah. Nilai tampilan dapat menyembunyikan nol atau tahun, sehingga tidak cukup sebagai bukti. Preview khusus juga belum menggunakan mapping tujuan tersimpan yang sudah digunakan integrasi lama.

Perbaikan membaca anchor berdasarkan merge aktual, bukan menyalin nilai atas ke bawah secara tebakan. Tanpa merge, pola lama tetap berlaku. Merge horizontal atau melintasi pasangan resi ditolak dengan alamat rentangnya. Status Q tetap diperiksa atas/bawah, atau sebagai gabungan berurutan jika Q memang di-merge. Angka mentah nol tetap nol walaupun ditampilkan kosong. Angka kosong/whitespace menjadi perbedaan yang perlu diverifikasi, bukan otomatis nol. Ini berlaku juga jika nilai angka sumber kosong. Tanda `-`/`--` numerik mengikuti konvensi parser OPS lama sebagai nol; untuk Via/OT, `-` adalah penanda kosong. Teks dibandingkan setelah trim, penyatuan whitespace (termasuk NBSP), dan kapitalisasi, tanpa menghapus tanda baca atau mengubah nama secara perkiraan.

Tanggal Date memakai zona waktu spreadsheet, serial angka memakai kalender Sheets (basis 1899-12-30), dan teks mendukung ISO atau hari/bulan/tahun. Tanggal nonkosong yang tidak dikenali tidak dianggap kosong. M3 `0,053` dan `0.053` sama-sama 0.053. Grup ribuan/desimal campuran harus valid; nilai mentah numerik tidak diparse ulang dari tampilannya. Untuk kolom non-M3, konvensi teks tiga digit tunggal seperti `1.234` tetap ribuan seperti parser sebelumnya; jika ekspor aktual memakai itu untuk pecahan Kg, perlu contoh sumber untuk menetapkan konvensi yang benar. Nilai sumber mentah dan nilai hasil parsing ditampilkan agar interpretasi ini dapat diaudit.

**Empat resi perusahaan belum diverifikasi.** Pengujian memakai data sintetis, bukan file atau spreadsheet perusahaan. Tersedianya nomor resi saja tidak membuktikan semua kolom identik. Data nyata tetap dapat menghasilkan konflik yang benar.

## Mapping yang diaudit dari kode

| Kolom Datot / tujuan | Nilai |
| --- | --- |
| A | Nomor urut slot; bukan atribut identitas resi |
| B / C | Tanggal masuk / tanggal berangkat |
| D / E / F / G | Pengirim / nomor resi / penerima / tujuan |
| H / I / J | Koli / Kg / M3 |
| K / L / M / N | Tunai / bayar tujuan / VA pengirim / VA tujuan |
| O / P | Via / OT |
| Q | Status, dipisahkan pada `<br>` sumber; atas/bawah sesuai template |
| R | Kode cabang |

Sumber tetap harus memiliki 18 kolom: A nomor urut tetap ada di ekspor, meski bukan nilai yang dibandingkan dengan nomor urut tujuan. Baris jumlah/total tidak menjadi resi. Data resi dengan jumlah kolom berubah, kunci resi pindah dari E, atau span yang tidak didukung ditolak. Pemeriksaan header E/G/R tetap menjadi pagar template; belum membuktikan semua header sumber/tujuan aktual karena berkas perusahaan belum tersedia.

Nomor resi dicari di baris atas dan dipakai sebagai kunci. Untuk kolom lain, posisi logis adalah baris bawah; jika sel tersebut termasuk merge vertikal dalam pasangan yang sama, nilai dibaca dari anchor atasnya. Tujuan hanya diterjemahkan memakai mapping tersimpan (`loadConfig_`), tanpa menebak hubungan kode dan nama. Formula S:Z tidak dibaca/diubah. Kandidat slot baru memeriksa isi dan formula di kedua baris B:P; Q:R lama tidak menentukan keterisian slot, tetapi rumus Q:R tetap dilindungi. A tidak direncanakan untuk ditulis.

## Uji lokal

Jalankan dari akar repository dengan Node.js 24:

```sh
node tests/bonus-preview.test.cjs
```

Suite memakai `node:test`, tanpa paket tambahan. Mock hanya menyediakan metode baca. Cakupan mencakup empat resi sintetis, campuran sel merged/unmerged, status, Date dengan timezone, serial Sheets, angka lokal, nol tersembunyi, sel kosong, mapping tujuan eksplisit, resi ganda, merge tidak sesuai, sumber rusak, serta slot berisi data/formula. Perubahan nominal, M3, teks dan tujuan tetap menjadi konflik penting. Tanggal berangkat menjadi informasi; status/cabang menjadi rencana Q:R sesuai kebijakan di atas. Pengujian reset penuh/parsial, proteksi formula, pencegahan duplikasi, serta preview berulang memeriksa bahwa isi, rumus dan merge mock tidak berubah. Uji endpoint memuat Kode.gs dan backend preview bersama, lalu memeriksa hasil READ_ONLY dan serialisasi diagnostik.

## Uji ulang di Apps Script

1. Tinjau PR terlebih dahulu. Pada proyek pengujian yang sudah memiliki Kode.gs, ganti hanya `OpsBonusStandbyPreview.gs` dan `BonusPreview.html` dengan versi branch ini. Jangan mengganti Index.html, OpsConsole.html, Kode.gs, manifest, Script Properties, atau rumus spreadsheet. File tests/docs tidak perlu dimasukkan ke editor Apps Script.
2. Simpan kode dan buka test deployment `/dev?bonus=1` sebagai pengguna yang berwenang. Gunakan halaman preview khusus ini; jangan menekan sinkronisasi pada panel integrasi lama.
3. Pilih **2026-11-02**, isi folder cabang dan spreadsheet HITUNGAN BONUS STANDBY CABANG PONTIANAK, serta link Datot 014PTK yang sama. Preview akan memeriksa tab **`2`**, bukan tab induk/rekap `BONUS`.
4. Jalankan preview. Pastikan mode tetap READ ONLY dan tidak ada tombol impor. Buka diagnostik setiap resi: cocokkan sumber mentah, pembanding setelah mapping, alamat anchor/merge, nilai mentah/tampilan tujuan, dan kedua hasil normalisasi.
5. Hasil 4 identik / 0 konflik hanya benar jika seluruh field memang sama menurut aturan di atas. Jika ada konflik, periksa field yang ditandai. Nol tidak boleh disimpulkan dari tampilan kosong; pastikan nilai mentahnya benar-benar `0`.
6. Pada **salinan pengujian** saja, siapkan empat pasangan dengan B:P kosong tanpa formula, sambil mempertahankan A, merge, Q:R lama, dan S:Z. Jalankan preview: empat resi baru harus direncanakan pada slot tersebut, bukan ditolak karena Q:R lama. Periksa alamat B:P dan Q:R pada laporan. Preview tidak mengisi sel mana pun.
7. Untuk resi lama pada salinan, gunakan tanggal berangkat/status/cabang berbeda: B:P harus masuk daftar dilewati, tanggal menjadi informasi, dan hanya Q:R masuk rencana perubahan. Nilai nominal berbeda tetap muncul sebagai konflik B:P. Formula B:P yang tampil kosong harus melindungi slot; formula Q:R harus memblokir rencana Q:R.
8. Bandingkan nilai, formula, merge dan format salinan sebelum/sesudah dua kali preview; semuanya harus tetap sama. Jangan mengubah spreadsheet perusahaan untuk pengujian dan jangan menjalankan endpoint commit integrasi lama.

Jika masih berbeda, kirim Datot `.xls` HTML asli (boleh disamarkan tetapi struktur kolom, format angka, tanggal dan `<br>` status dipertahankan), header tab `2` rentang **A2:R3**, serta **A:R pada dua baris setiap resi yang bermasalah**. Bila empat resi ada pada slot awal, rentangnya **A5:R12**; jika tidak, gunakan pasangan baris yang ditunjukkan diagnostik. Sertakan daftar rentang merge di area tersebut dan nilai mentah/tampilan dari diagnostik. Ekspor CSV saja tidak memuat bukti merge atau tipe Date. Tidak perlu mengirim kolom S:Z, kredensial, atau seluruh workbook.
