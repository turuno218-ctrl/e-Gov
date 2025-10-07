document.addEventListener('DOMContentLoaded', () => {
    // DOM要素の取得
    const uploadContainer = document.getElementById('upload-container');
    const viewerSection = document.getElementById('viewer-section');
    const controls = document.getElementById('controls');
    const viewer = document.getElementById('viewer');
    const downloadPdfBtn = document.getElementById('download-pdf');
    const downloadPngBtn = document.getElementById('download-png');
    const loadingOverlay = document.getElementById('loading');
    
    let documentPairs = [];
    let currentPair = null;
    let originalFileName = 'document';

    // 初期UIの描画
    const dropZoneHTML = `
        <div id="drop-zone">
            <p>ここにZIPファイルをドラッグ＆ドロップ</p>
            <p>または</p>
            <label for="file-input" class="file-label">ファイルを選択</label>
            <input type="file" id="file-input" accept=".zip" class="hidden">
        </div>`;

    function renderInitialUI() {
        uploadContainer.innerHTML = dropZoneHTML;
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');

        dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', e => {
            if (e.target.files.length > 0) handleFile(e.target.files[0]);
        });
        dropZone.addEventListener('click', () => fileInput.click());
    }

    // ファイル処理
    async function handleFile(file) {
        if (!file.name.endsWith('.zip')) {
            alert('ZIPファイルをアップロードしてください。');
            return;
        }
        showLoading(true);

        try {
            const zip = await JSZip.loadAsync(file);
            const xmlFiles = Object.values(zip.files).filter(e => e.name.toLowerCase().endsWith('.xml') && !e.dir);
            if (xmlFiles.length === 0) throw new Error('ZIPファイル内にXMLファイルが見つかりません。');
            
            const pairs = await Promise.all(xmlFiles.map(async xmlFile => {
                const xmlContent = await xmlFile.async('string');
                const match = xmlContent.match(/<\?xml-stylesheet\s+type="text\/xsl"\s+href="([^"]+)"\?>/);
                if (match && match[1]) {
                    const xslFileName = match[1];
                    const xslFile = Object.values(zip.files).find(e => !e.dir && e.name.toLowerCase().endsWith(xslFileName.toLowerCase()));
                    if (xslFile) return { name: xmlFile.name, xml: await xmlFile.async('string'), xsl: await xslFile.async('string') };
                }
                return null;
            }));
            documentPairs = pairs.filter(Boolean);

            if (documentPairs.length === 0) throw new Error('処理可能なXMLとXSLのペアが見つかりませんでした。');
            
            if (documentPairs.length === 1) {
                currentPair = documentPairs[0];
                displayDocument();
                uploadContainer.classList.add('hidden');
            } else {
                showFileSelection();
            }
        } catch (error) {
            console.error('エラー:', error);
            alert(`処理中にエラーが発生しました: ${error.message}`);
            renderInitialUI();
        } finally {
            showLoading(false);
        }
    }

    // 複数ファイル選択UIの表示
    function showFileSelection() {
        let buttonsHTML = documentPairs.map((pair, index) => 
            `<button data-index="${index}">${pair.name}</button>`
        ).join('');

        uploadContainer.innerHTML = `
            <div id="file-list-container">
                <h3>表示するファイルを選択してください</h3>
                <div id="file-list">${buttonsHTML}</div>
            </div>`;

        const fileList = document.getElementById('file-list');
        fileList.addEventListener('click', e => {
            if (e.target.tagName === 'button') {
                const index = e.target.dataset.index;
                currentPair = documentPairs[index];
                
                // 選択されたボタンをハイライト
                fileList.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');

                displayDocument();
            }
        });
    }

    // 文書をビューアに表示
    function displayDocument() {
        originalFileName = currentPair.name.replace(/\.xml$/i, '');
        
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(currentPair.xml, "application/xml");
        const xslDoc = parser.parseFromString(currentPair.xsl, "application/xml");
        if (xmlDoc.getElementsByTagName("parsererror").length || xslDoc.getElementsByTagName("parsererror").length) {
            throw new Error("XMLまたはXSLのパースに失敗しました。");
        }
        
        const xsltProcessor = new XSLTProcessor();
        xsltProcessor.importStylesheet(xslDoc);
        const resultDocument = xsltProcessor.transformToFragment(xmlDoc, document);
        
        viewer.innerHTML = '';
        if (resultDocument) viewer.appendChild(resultDocument);
        else throw new Error("XSLT変換に失敗しました。");
        
        viewerSection.classList.remove('hidden');
    }

    function showLoading(show) {
        loadingOverlay.classList.toggle('hidden', !show);
    }
    
    // PDFダウンロード機能
    downloadPdfBtn.addEventListener('click', async () => {
        showLoading(true);
        try {
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();

            const canvas = await html2canvas(viewer, {
                scale: 2, useCORS: true,
                windowWidth: viewer.scrollWidth, windowHeight: viewer.scrollHeight,
            });

            const contentHeight = canvas.height, contentWidth = canvas.width;
            const pageHeightInCanvas = (contentWidth / pdfWidth) * pdfHeight;
            let currentHeight = 0;

            while (currentHeight < contentHeight) {
                const pageCanvas = document.createElement('canvas');
                pageCanvas.width = contentWidth;
                pageCanvas.height = pageHeightInCanvas;
                const pageCtx = pageCanvas.getContext('2d');
                
                pageCtx.drawImage(canvas, 0, currentHeight, contentWidth, pageHeightInCanvas, 0, 0, contentWidth, pageHeightInCanvas);
                
                if (currentHeight > 0) pdf.addPage();
                pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', 0, 0, pdfWidth, pdfHeight);
                currentHeight += pageHeightInCanvas;
            }
            pdf.save(`${originalFileName}.pdf`);

        } catch (err) {
            console.error("PDF生成エラー:", err);
            alert(`PDFの生成に失敗しました。\nエラー: ${err.message || '不明なエラー'}`);
        } finally {
            showLoading(false);
        }
    });

    // PNG保存機能
    downloadPngBtn.addEventListener('click', async () => {
        showLoading(true);
        try {
            const canvas = await html2canvas(viewer, {
                scale: 2, useCORS: true,
                width: viewer.clientWidth, height: (viewer.clientWidth / 210) * 297,
                windowHeight: (viewer.clientWidth / 210) * 297,
            });
            const link = document.createElement('a');
            link.download = `${originalFileName}_page1.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (err) {
            console.error("PNG生成エラー:", err);
            alert(`PNG画像の生成に失敗しました。\nエラー: ${err.message || '不明なエラー'}`);
        } finally {
            showLoading(false);
        }
    });
    
    // 初期化
    renderInitialUI();
});

