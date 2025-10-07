document.addEventListener('DOMContentLoaded', () => {
    // DOM要素の取得
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const controls = document.getElementById('controls');
    const viewerContainer = document.getElementById('viewer-container');
    const viewer = document.getElementById('viewer');
    const downloadPdfBtn = document.getElementById('download-pdf');
    const downloadPngBtn = document.getElementById('download-png');
    const loadingOverlay = document.getElementById('loading');
    const fileListContainer = document.getElementById('file-list-container');
    const fileList = document.getElementById('file-list');

    let originalFileName = 'document';

    // ドラッグ＆ドロップ、ファイル選択のイベント設定
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

    // ファイル処理のメイン関数
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
            const xmlFiles = [];
            zip.forEach((relativePath, zipEntry) => {
                if (relativePath.toLowerCase().endsWith('.xml') && !zipEntry.dir) {
                    xmlFiles.push(zipEntry);
                }
            });

            if (xmlFiles.length === 0) {
                throw new Error('ZIPファイル内にXMLファイルが見つかりません。');
            }

            const documentPairs = [];
            for (const xmlFile of xmlFiles) {
                const xmlContent = await xmlFile.async('string');
                const stylesheetRegex = /<\?xml-stylesheet\s+type="text\/xsl"\s+href="([^"]+)"\?>/;
                const match = xmlContent.match(stylesheetRegex);

                if (match && match[1]) {
                    const xslFileName = match[1];
                    // ZIPファイル内からファイル名が一致するものを探す（パスは無視）
                    const xslFileEntry = Object.values(zip.files).find(entry => 
                        !entry.dir && entry.name.toLowerCase().endsWith(xslFileName.toLowerCase())
                    );
                    
                    if (xslFileEntry) {
                        documentPairs.push({
                            name: xmlFile.name,
                            xmlFile: xmlFile,
                            xslFile: xslFileEntry
                        });
                    }
                }
            }

            if (documentPairs.length === 0) {
                throw new Error('処理可能なXMLとXSLのペアが見つかりませんでした。\nXMLファイル内に`<?xml-stylesheet...`の記述があるか確認してください。');
            }

            if (documentPairs.length === 1) {
                // ペアが1組だけなら直接表示
                const pair = documentPairs[0];
                const xmlContent = await pair.xmlFile.async('string');
                const xslContent = await pair.xslFile.async('string');
                displayTransformedXml(xmlContent, xslContent);
                showViewer();
            } else {
                // 複数あれば選択肢を表示
                showFileSelection(documentPairs);
            }

        } catch (error) {
            console.error('エラー:', error);
            alert(`処理中にエラーが発生しました: ${error.message}`);
        } finally {
            showLoading(false);
        }
    }

    // ファイル選択UIを表示する関数
    function showFileSelection(pairs) {
        fileList.innerHTML = ''; // リストをクリア
        pairs.forEach(pair => {
            const button = document.createElement('button');
            button.textContent = pair.name;
            button.addEventListener('click', async () => {
                showLoading(true);
                try {
                    const xmlContent = await pair.xmlFile.async('string');
                    const xslContent = await pair.xslFile.async('string');
                    displayTransformedXml(xmlContent, xslContent);
                    showViewer();
                } catch (e) {
                    alert(`ファイルの表示に失敗しました: ${e.message}`);
                } finally {
                    showLoading(false);
                }
            });
            fileList.appendChild(button);
        });
        fileListContainer.classList.remove('hidden');
    }
    
    // XSLT変換と表示
    function displayTransformedXml(xmlString, xslString) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, 'application/xml');
        const xslDoc = parser.parseFromString(xslString, 'application/xml');

        if (xmlDoc.getElementsByTagName("parsererror").length || xslDoc.getElementsByTagName("parsererror").length) {
            throw new Error("XMLまたはXSLのパースに失敗しました。");
        }

        const xsltProcessor = new XSLTProcessor();
        xsltProcessor.importStylesheet(xslDoc);
        const resultDocument = xsltProcessor.transformToFragment(xmlDoc, document);
        
        viewer.innerHTML = '';
        if (resultDocument) {
            viewer.appendChild(resultDocument);
        } else {
            throw new Error("XSLT変換に失敗しました。");
        }
    }

    // UI表示の制御
    function resetUI() {
        controls.classList.add('hidden');
        viewerContainer.classList.add('hidden');
        fileListContainer.classList.add('hidden');
        dropZone.classList.remove('hidden');
    }

    function showViewer() {
        dropZone.classList.add('hidden');
        fileListContainer.classList.add('hidden');
        controls.classList.remove('hidden');
        viewerContainer.classList.remove('hidden');
    }
    
    // ローディング表示
    function showLoading(show) {
        loadingOverlay.classList.toggle('hidden', !show);
    }

    // PDF/PNGダウンロード機能（変更なし）
    downloadPdfBtn.addEventListener('click', () => {
        showLoading(true);
        const { jsPDF } = window.jspdf;
        html2canvas(viewer, { scale: 2, useCORS: true }).then(canvas => {
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            pdf.addImage(imgData, 'PNG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
            pdf.save(`${originalFileName}.pdf`);
        }).catch(err => {
            console.error("PDF生成エラー:", err);
            alert("PDFの生成に失敗しました。");
        }).finally(() => showLoading(false));
    });

    downloadPngBtn.addEventListener('click', () => {
        showLoading(true);
        html2canvas(viewer, { scale: 2, useCORS: true }).then(canvas => {
            const link = document.createElement('a');
            link.download = `${originalFileName}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        }).catch(err => {
            console.error("PNG生成エラー:", err);
            alert("PNG画像の生成に失敗しました。");
        }).finally(() => showLoading(false));
    });
});
