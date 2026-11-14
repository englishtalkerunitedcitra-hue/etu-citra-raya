# Ruang Tim CS & Sales: tiga cabang

Ruang Tim memakai satu database dan satu tab ekspor `ETU App - Master Prospek`
di workbook ETU. Pilihan cabang yang tetap adalah ETU Taman Royal, ETU Citra
Raya, dan ETU Palem Semi. Admin melihat tombol Semua Cabang dan ketiga cabang;
staf melihat cabangnya sendiri. Ringkasan dan daftar prospek mengikuti tombol
yang dipilih. Setiap kartu prospek menampilkan nama cabang.

`sales_leads.branch_code` adalah sumber data cabang. Enam prospek yang sudah
ada tetap di Citra Raya. Staf baru diberi cabang saat undangan; admin dapat
mengubah cabangnya setelah prospek yang menjadi tanggung jawab staf dipindahkan.
Staf hanya dapat menyimpan dan membaca prospek miliknya di cabang yang
ditugaskan. Admin dapat memindahkan prospek dan PIC antar cabang, dengan PIC
yang aktif di cabang tujuan atau akun admin. Aktivitas dan Top 3 mengikuti
izin prospek yang sama.

Kolom `Cabang` ditambahkan sebagai kolom AO pada tab ekspor aplikasi, setelah
40 kolom yang sudah ada. Tab `Master Prospek` manual dan formula Dashboard
lama tidak diubah. Seluruh prospek lama diekspor ulang agar AO terisi.
Sinkronisasi tetap satu arah dari database ke tab aplikasi. Jangan memindahkan
baris di tab aplikasi secara manual.

## Rilis 14 November 2026

Sebelum perubahan, workbook dan tabel prospek, profil staf, antrean Sheet,
serta konfigurasi disalin sebagai cadangan. Sinkron dijeda, migrasi
`20261114092526` diterapkan, header AO ditambahkan, lalu fungsi `sheets-sync`
dan `staff-admin` diperbarui dengan verifikasi JWT tetap aktif. Setelah
antrean Master dikirim ulang, sinkron otomatis diaktifkan kembali. Frontend
GitHub Pages diterbitkan setelah backend dan ekspor diverifikasi.

Pengujian lokal meliputi login undangan, penyimpanan staf, pembatasan antar
cabang dan antar PIC, tampilan tombol cabang di browser, penyimpanan seluler,
serta alur trial publik. Data uji lokal tidak dikirim ke produksi.
