// app.js (Versi Perbaikan)

document.addEventListener('DOMContentLoaded', () => {
    // Inisialisasi Database IndexedDB
    let db;
    const request = indexedDB.open('StrukScannerDB', 2);

    request.onupgradeneeded = (event) => {
        db = event.target.result;
        if (!db.objectStoreNames.contains('struk')) {
            const store = db.createObjectStore('struk', { keyPath: 'id', autoIncrement: true });
            store.createIndex('timestamp', 'timestamp', { unique: false });
        }
    };

    request.onsuccess = (event) => {
        db = event.target.result;
        loadHistory();
    };
    request.onerror = (event) => console.error("Database error: ", event.target.errorCode);

    // Elemen DOM
    const imageUpload = document.getElementById('imageUpload');
    const preview = document.getElementById('preview');
    const loader = document.getElementById('loader');
    const output = document.getElementById('output');
    const downloadBtn = document.getElementById('downloadBtn');
    let parsedDataForSheet = {};

    imageUpload.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            preview.src = e.target.result;
            preview.classList.remove('d-none');
            runOCR(file);
        };
        reader.readAsDataURL(file);
    });

    const cleanPrice = (priceString) => {
        if (typeof priceString !== 'string') return 0;
        return parseInt(priceString.replace(/[.,]/g, ''), 10) || 0;
    };

    const parseReceiptText = (text) => {
        const lines = text.split('\n');
        const items = [];
        let total = 0;
        const itemRegex = /(.+?)\s+([\d.,]+)$/;
        const totalRegex = /^(TOTAL|TAGIHAN|JUMLAH)\s*[:\s]?\s*([\d.,]+)/i;
        const nonItemKeywords = ['SUBTOTAL', 'DISKON', 'PPN', 'TUNAI', 'KEMBALI', 'CHANGE', 'TOTAL', 'TAGIHAN'];

        for (const line of lines) {
            const totalMatch = line.match(totalRegex);
            if (totalMatch) {
                total = cleanPrice(totalMatch[2]);
                continue;
            }
            const itemMatch = line.match(itemRegex);
            if (itemMatch) {
                const itemName = itemMatch[1].trim();
                const itemPrice = cleanPrice(itemMatch[2]);
                const isKeyword = nonItemKeywords.some(keyword => itemName.toUpperCase().includes(keyword));
                if (!isKeyword && isNaN(parseInt(itemName)) && itemPrice > 0) {
                    items.push({ name: itemName, price: itemPrice });
                }
            }
        }
        if (total === 0 && items.length > 0) {
             const prices = items.map(item => item.price);
             total = Math.max(...prices);
        }
        return { items, total };
    };
    
    const displayParsedData = (data) => {
        if (data.items.length === 0) {
            output.innerHTML = `<p class="text-danger">Tidak ada item yang dapat dikenali. Menampilkan teks mentah:</p><pre>${data.rawText}</pre>`;
            return;
        }
        let tableHTML = `<table class="table table-striped results-table">
                            <thead><tr><th>Nama Item</th><th class="text-end">Harga</th></tr></thead>
                            <tbody>`;
        data.items.forEach(item => {
            tableHTML += `<tr>
                            <td>${item.name}</td>
                            <td class="text-end">${item.price.toLocaleString('id-ID')}</td>
                          </tr>`;
        });
        tableHTML += `<tr class="total-row">
                        <td>TOTAL</td>
                        <td class="text-end">Rp ${data.total.toLocaleString('id-ID')}</td>
                      </tr>`;
        tableHTML += `</tbody></table>`;
        output.innerHTML = tableHTML;
    };

    const runOCR = async (file) => {
        loader.classList.remove('d-none');
        output.innerHTML = '';
        downloadBtn.classList.add('d-none');
        Swal.fire({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, timerProgressBar: true, icon: 'info', title: 'Sedang memproses...' });
        try {
            const { data: { text } } = await Tesseract.recognize(file, 'ind');
            const parsedData = parseReceiptText(text);
            if (parsedData.items.length === 0 && parsedData.total === 0) {
                Swal.fire('Info', 'Tidak dapat memisahkan item dan total secara otomatis. Silakan periksa teks mentah.', 'warning');
                 output.innerHTML = `<p class="text-muted">Teks Mentah:</p><pre>${text}</pre>`;
            } else {
                 Swal.fire('Sukses!', `Berhasil mengenali ${parsedData.items.length} item.`, 'success');
            }
            displayParsedData({ ...parsedData, rawText: text });
            const timestamp = new Date().toLocaleString('id-ID');
            saveToDatabase({ rawText: text, parsed: parsedData, timestamp });
            prepareForSheet(parsedData);
        } catch (error) {
            Swal.fire('Oops...', 'Gagal menganalisis gambar. Pastikan gambar jelas.', 'error');
            console.error(error);
        } finally {
            loader.classList.add('d-none');
        }
    };
    
    const prepareForSheet = (parsedData) => {
        if(parsedData.items.length === 0) {
            downloadBtn.classList.add('d-none');
            return;
        }
        parsedDataForSheet = parsedData.items.map(item => ({
            "Nama Item": item.name,
            "Harga": item.price
        }));
        parsedDataForSheet.push({});
        parsedDataForSheet.push({ "Nama Item": "TOTAL", "Harga": parsedData.total });
        downloadBtn.classList.remove('d-none');
    };

    downloadBtn.addEventListener('click', () => {
        const worksheet = XLSX.utils.json_to_sheet(parsedDataForSheet);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Rincian Struk");
        XLSX.writeFile(workbook, `Struk_Scan_${Date.now()}.xlsx`);
    });

    const saveToDatabase = (data) => {
        const transaction = db.transaction(['struk'], 'readwrite');
        const store = transaction.objectStore('struk');
        store.add(data);
        transaction.oncomplete = () => loadHistory();
    };

    // ### KODE YANG DIPERBAIKI ADA DI FUNGSI INI ###
    const loadHistory = () => {
        if (!db) return;
        const store = db.transaction(['struk'], 'readonly').objectStore('struk');
        const request = store.getAll();

        request.onsuccess = () => {
            const historyData = request.result.reverse();
            let html = `<table class="table table-hover">
                            <thead><tr><th>Waktu Pindai</th><th>Jumlah Item</th><th class="text-end">Total</th></tr></thead>
                            <tbody>`;
            if (historyData.length > 0) {
                historyData.forEach(item => {
                    const itemCount = item.parsed?.items?.length || 0;
                    const totalAmount = item.parsed?.total || 0;
                    
                    // Memformat angka ke string DILUAR template literal untuk keamanan
                    const formattedTotal = totalAmount.toLocaleString('id-ID');

                    html += `
                        <tr>
                            <td>${item.timestamp}</td>
                            <td>${itemCount} item</td>
                            <td class="text-end">Rp ${formattedTotal}</td>
                        </tr>
                    `;
                });
            } else {
                html += `<tr><td colspan="3" class="text-center text-muted">Belum ada riwayat.</td></tr>`;
            }
            html += `</tbody></table>`;
            document.getElementById('historyTable').innerHTML = html;
        };
    };
});