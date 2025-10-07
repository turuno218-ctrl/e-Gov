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
    const placeholderHTML = `<div id="placeholder"><p>ZIPファイルをアップロードすると、ここにプレビューが表示されます。</p></div>`;

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
            const xmlFiles = Object.values(zip.files).filter(entry => entry.name.toLowerCase().endsWith('.xml') && !entry.dir);

            if (xmlFiles.length === 0) throw new Error('ZIPファイル内にXMLファイルが見つかりません。');

            const documentPairs = [];
            for (const xmlFile of xmlFiles) {
                const xmlContent = await xmlFile.async('string');
                const match = xmlContent.match(/<\?xml-stylesheet\s+type="text\/xsl"\s+href="([^"]+)"\?>/);
                if (match && match[1]) {
                    const xslFileName = match[1];
                    const xslFileEntry = Object.values(zip.files).find(entry => !entry.dir && entry.name.toLowerCase().endsWith(xslFileName.toLowerCase()));
                    if (xslFileEntry) documentPairs.push({ name: xmlFile.name, xmlFile, xslFile: xslFileEntry });
                }
            }

            if (documentPairs.length === 0) throw new Error('処理可能なXMLとXSLのペアが見つかりませんでした。\nXMLファイル内に`<?xml-stylesheet...`の記述があるか確認してください。');

            dropZone.classList.add('hidden');
            if (documentPairs.length === 1) {
                const pair = documentPairs[0];
                const xmlContent = await pair.xmlFile.async('string');
                const xslContent = await pair.xslFile.async('string');
                displayTransformedXml(xmlContent, xslContent);
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

    function showFileSelection(pairs) {
        fileList.innerHTML = '';
        pairs.forEach(pair => {
            const button = document.createElement('button');
            button.textContent = pair.name;
            button.addEventListener('click', async () => {
                showLoading(true);
                try {
                    const xmlContent = await pair.xmlFile.async('string');
                    const xslContent = await pair.xslFile.async('string');
                    displayTransformedXml(xmlContent, xslContent);
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
        const xmlDoc = parser.parseFromString(xmlString, 'application/xml');
        const xslDoc = parser.parseFromString(xslString, 'application/xml');
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

    function resetUI() {
        controls.classList.add('hidden');
        fileListContainer.classList.add('hidden');
        fileList.innerHTML = '';
        viewer.innerHTML = placeholderHTML;
        dropZone.classList.remove('hidden');
        fileInput.value = ''; // ファイル選択をリセット
    }

    function showLoading(show) {
        loadingOverlay.classList.toggle('hidden', !show);
    }
    
    // ★画像読み込みを待機する関数
    function waitForImagesToLoad(element) {
        const images = Array.from(element.getElementsByTagName('img'));
        const promises = images.map(img => new Promise((resolve, reject) => {
            if (img.complete) resolve();
            else {
                img.onload = resolve;
                img.onerror = reject;
            }
        }));
        return Promise.all(promises);
    }

    // ★PDFダウンロード機能を改善
    downloadPdfBtn.addEventListener('click', async () => {
        showLoading(true);
        try {
            await waitForImagesToLoad(viewer);
            const { jsPDF } = window.jspdf;
            const canvas = await html2canvas(viewer, { scale: 2, useCORS: true });
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            pdf.addImage(imgData, 'PNG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
            pdf.save(`${originalFileName}.pdf`);
        } catch (err) {
            console.error("PDF生成エラー:", err);
            alert(`PDFの生成に失敗しました。\nエラー: ${err.message || '不明なエラー'}`);
        } finally {
            showLoading(false);
        }
    });

    // ★PNG保存機能を改善
    downloadPngBtn.addEventListener('click', async () => {
        showLoading(true);
        try {
            await waitForImagesToLoad(viewer);
            const canvas = await html2canvas(viewer, { scale: 2, useCORS: true });
            const link = document.createElement('a');
            link.download = `${originalFileName}.png`;
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

