document.addEventListener('DOMContentLoaded', () => {
    // DOM要素の取得
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const controls = document.getElementById('controls');
    const viewer = document.getElementById('viewer');
    const downloadPdfBtn = document.getElementById('download-pdf');
    const downloadPngBtn = document.getElementById('download-png');
    const loadingOverlay = document.getElementById('loading');
    const fileListContainer = document.getElementById('file-list-container');
    const fileList = document.getElementById('file-list');

    let originalFileName = 'document';
    const placeholderHTML = `<div id="placeholder"><p>ZIPファイルをアップロードすると、ここにプレビューが表示されます。</p></div>`;

    // イベントリスナー設定
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

    // ファイル処理
    async function handleFile(file) {
        if (!file.name.endsWith('.zip')) {
            alert('ZIPファイルをアップロードしてください。');
            return;
        }
        originalFileName = file.name.replace('.zip', '');
        showLoading(true);
        resetUI();

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
                    if (xslFile) return { name: xmlFile.name, xmlFile, xslFile };
                }
                return null;
            }));
            const documentPairs = pairs.filter(Boolean);

            if (documentPairs.length === 0) throw new Error('処理可能なXMLとXSLのペアが見つかりませんでした。');

            dropZone.classList.add('hidden');
            if (documentPairs.length === 1) {
                await displayDocument(documentPairs[0]);
                controls.classList.remove('hidden');
            } else {
                showFileSelection(documentPairs);
                fileListContainer.classList.remove('hidden');
            }
        } catch (error) {
            console.error('エラー:', error);
            alert(`処理中にエラーが発生しました: ${error.message}`);
            resetUI();
        } finally {
            showLoading(false);
        }
    }

    async function displayDocument(pair) {
        const xmlContent = await pair.xmlFile.async('string');
        const xslContent = await pair.xslFile.async('string');
        originalFileName = pair.name.replace(/\.xml$/i, '');
        displayTransformedXml(xmlContent, xslContent);
    }

    function showFileSelection(pairs) {
        fileList.innerHTML = '';
        pairs.forEach(pair => {
            const button = document.createElement('button');
            button.textContent = pair.name;
            button.addEventListener('click', async () => {
                showLoading(true);
                try {
                    await displayDocument(pair);
                    fileListContainer.classList.add('hidden');
                    controls.classList.remove('hidden');
                } catch (e) {
                    alert(`ファイルの表示に失敗しました: ${e.message}`);
                    viewer.innerHTML = placeholderHTML;
                } finally {
                    showLoading(false);
                }
            });
            fileList.appendChild(button);
        });
    }

    function displayTransformedXml(xmlString, xslString) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, "application/xml");
        const xslDoc = parser.parseFromString(xslString, "application/xml");
        if (xmlDoc.getElementsByTagName("parsererror").length || xslDoc.getElementsByTagName("parsererror").length) {
            throw new Error("XMLまたはXSLのパースに失敗しました。");
        }
        const xsltProcessor = new XSLTProcessor();
        xsltProcessor.importStylesheet(xslDoc);
        const resultDocument = xsltProcessor.transformToFragment(xmlDoc, document);
        viewer.innerHTML = '';
        if (resultDocument) viewer.appendChild(resultDocument);
        else throw new Error("XSLT変換に失敗しました。");
    }

    // UIリセットとローディング表示
    function resetUI() {
        controls.classList.add('hidden');
        fileListContainer.classList.add('hidden');
        viewer.innerHTML = placeholderHTML;
        dropZone.classList.remove('hidden');
        fileInput.value = '';
    }

    function showLoading(show) {
        loadingOverlay.classList.toggle('hidden', !show);
    }

    // ★PDFダウンロード機能を、手動ページ分割ロジックで書き換え
    downloadPdfBtn.addEventListener('click', async () => {
        showLoading(true);
        try {
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();

            const canvas = await html2canvas(viewer, {
                scale: 2,
                useCORS: true,
                // windowWidth, windowHeightを指定することで、画面に表示されていない部分も描画対象にする
                windowWidth: viewer.scrollWidth,
                windowHeight: viewer.scrollHeight,
            });

            const contentHeight = canvas.height;
            const contentWidth = canvas.width;
            
            // A4のアスペクト比に合わせて、1ページあたりの高さを計算
            const pageHeightInCanvas = (contentWidth / pdfWidth) * pdfHeight;
            let currentHeight = 0;

            while (currentHeight < contentHeight) {
                const pageCanvas = document.createElement('canvas');
                pageCanvas.width = contentWidth;
                pageCanvas.height = pageHeightInCanvas;
                const pageCtx = pageCanvas.getContext('2d');

                // 元の大きなCanvasから、1ページ分の内容を切り出して描画
                pageCtx.drawImage(canvas, 0, currentHeight, contentWidth, pageHeightInCanvas, 0, 0, contentWidth, pageHeightInCanvas);
                
                if (currentHeight > 0) {
                    pdf.addPage();
                }
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

    // PNG保存機能（1ページ目のみ）
    downloadPngBtn.addEventListener('click', async () => {
        showLoading(true);
        try {
            const canvas = await html2canvas(viewer, {
                scale: 2,
                useCORS: true,
                // A4サイズ1枚分だけをキャプチャするように範囲を指定
                width: viewer.clientWidth,
                height: (viewer.clientWidth / 210) * 297,
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
});

