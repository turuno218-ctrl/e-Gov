document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const controls = document.getElementById('controls');
    const viewer = document.getElementById('viewer');
    const downloadPdfBtn = document.getElementById('download-pdf');
    const downloadPngBtn = document.getElementById('download-png');
    const loadingOverlay = document.getElementById('loading');
    
    let originalFileName = 'document';

    // ドラッグ＆ドロップのイベントリスナー
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });

    // ファイル選択のイベントリスナー
    fileInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
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

        try {
            const zip = await JSZip.loadAsync(file);
            let xmlFile = null;
            let xslFile = null;
            let xmlContent = '';
            let xslContent = '';

            const filePromises = [];
            zip.forEach((relativePath, zipEntry) => {
                const lowerCasePath = relativePath.toLowerCase();
                if (lowerCasePath.endsWith('.xml')) {
                    xmlFile = zipEntry;
                } else if (lowerCasePath.endsWith('.xsl') || lowerCasePath.endsWith('.xslt')) {
                    xslFile = zipEntry;
                }
                filePromises.push(zipEntry.async('string'));
            });

            await Promise.all(filePromises);

            if (!xmlFile) {
                throw new Error('ZIPファイル内にXMLファイルが見つかりません。');
            }
            
            xmlContent = await xmlFile.async('string');

            // XML内の `xml-stylesheet` 処理命令を探す
            const stylesheetRegex = /<\?xml-stylesheet\s+type="text\/xsl"\s+href="([^"]+)"\?>/;
            const match = xmlContent.match(stylesheetRegex);

            if (match && match[1]) {
                const xslFileName = match[1];
                const foundXslFile = zip.file(new RegExp(xslFileName.replace(/\\/g, '/').split('/').pop() + '$', 'i'));
                if (foundXslFile.length > 0) {
                    xslFile = foundXslFile[0];
                }
            }
            
            if (!xslFile) {
                throw new Error('対応するXSLファイルが見つかりません。XMLファイル内で `<?xml-stylesheet...` の指定を確認してください。');
            }
            
            xslContent = await xslFile.async('string');

            // XMLとXSLを変換して表示
            displayTransformedXml(xmlContent, xslContent);

            controls.classList.remove('hidden');
            dropZone.classList.add('hidden');

        } catch (error) {
            console.error('エラー:', error);
            alert(`処理中にエラーが発生しました: ${error.message}`);
        } finally {
            showLoading(false);
        }
    }

    // XSLT変換を行い、結果をビューアに表示
    function displayTransformedXml(xmlString, xslString) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, 'application/xml');
        const xslDoc = parser.parseFromString(xslString, 'application/xml');

        // エラーチェック
        if (xmlDoc.getElementsByTagName("parsererror").length || xslDoc.getElementsByTagName("parsererror").length) {
            console.error("XMLまたはXSLのパースに失敗しました。");
            alert("XMLまたはXSLファイルの形式が正しくありません。");
            return;
        }

        const xsltProcessor = new XSLTProcessor();
        xsltProcessor.importStylesheet(xslDoc);
        const resultDocument = xsltProcessor.transformToFragment(xmlDoc, document);
        
        viewer.innerHTML = ''; // 以前の内容をクリア
        if(resultDocument) {
            viewer.appendChild(resultDocument);
        } else {
            viewer.innerHTML = '<p style="color:red; text-align:center; padding-top: 50px;">変換に失敗しました。XMLとXSLの内容を確認してください。</p>';
        }
    }

    // PDFダウンロード機能
    downloadPdfBtn.addEventListener('click', () => {
        showLoading(true);
        const { jsPDF } = window.jspdf;

        html2canvas(viewer, {
            scale: 2, // 高解像度化
            useCORS: true
        }).then(canvas => {
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();
            
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`${originalFileName}.pdf`);
            showLoading(false);
        }).catch(err => {
            console.error("PDF生成エラー:", err);
            alert("PDFの生成に失敗しました。");
            showLoading(false);
        });
    });

    // PNG保存機能
    downloadPngBtn.addEventListener('click', () => {
        showLoading(true);
        html2canvas(viewer, {
            scale: 2, // 高解像度化
            useCORS: true
        }).then(canvas => {
            const link = document.createElement('a');
            link.download = `${originalFileName}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            showLoading(false);
        }).catch(err => {
            console.error("PNG生成エラー:", err);
            alert("PNG画像の生成に失敗しました。");
            showLoading(false);
        });
    });

    // ローディング表示の切り替え
    function showLoading(show) {
        loadingOverlay.classList.toggle('hidden', !show);
    }
});