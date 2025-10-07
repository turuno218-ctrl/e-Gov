document.addEventListener('DOMContentLoaded', () => {
    // DOM要素の取得
    const fileInput = document.getElementById('file-input');
    const fileNameSpan = document.getElementById('file-name');
    const resultSection = document.getElementById('result-section');
    const fileListContainer = document.getElementById('file-list');
    const viewerContainer = document.getElementById('viewer-container');
    const viewer = document.getElementById('viewer'); // now an iframe
    const downloadPdfBtn = document.getElementById('download-pdf');
    const downloadPngBtn = document.getElementById('download-png');
    const loadingOverlay = document.getElementById('loading');
    
    let documentPairs = [];
    let originalFileName = 'document';

    // ファイルが選択されたときの処理
    fileInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) {
            fileNameSpan.textContent = file.name;
            handleFile(file);
        }
    });

    // ファイル処理のメイン関数
    async function handleFile(file) {
        if (!file.name.endsWith('.zip')) {
            alert('ZIPファイルをアップロードしてください。');
            resetUI();
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
                    if (xslFile) return { 
                        name: xmlFile.name, 
                        xml: await xmlFile.async('string'), 
                        xsl: await xslFile.async('string') 
                    };
                }
                return null;
            }));
            documentPairs = pairs.filter(Boolean);

            if (documentPairs.length === 0) throw new Error('処理可能なXMLとXSLのペアが見つかりませんでした。');
            
            renderResultUI();

        } catch (error) {
            console.error('エラー:', error);
            alert(`処理中にエラーが発生しました: ${error.message}`);
            resetUI();
        } finally {
            showLoading(false);
        }
    }
    
    // 処理結果エリアのUIを構築
    function renderResultUI() {
        fileListContainer.innerHTML = '';
        viewerContainer.classList.add('hidden');
        
        documentPairs.forEach((pair, index) => {
            const button = document.createElement('button');
            button.textContent = pair.name;
            button.dataset.index = index;
            button.addEventListener('click', e => {
                displayDocument(index);
                fileListContainer.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
                e.currentTarget.classList.add('active');
            });
            fileListContainer.appendChild(button);
        });
        
        resultSection.classList.remove('hidden');

        if (documentPairs.length === 1) {
            fileListContainer.querySelector('button').click();
        }
    }

    // ★文書をiframeに表示するように変更
    function displayDocument(index) {
        const pair = documentPairs[index];
        originalFileName = pair.name.replace(/\.xml$/i, '');
        showLoading(true);

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(pair.xml, "application/xml");
            const xslDoc = parser.parseFromString(pair.xsl, "application/xml");
            if (xmlDoc.getElementsByTagName("parsererror").length || xslDoc.getElementsByTagName("parsererror").length) {
                throw new Error("XMLまたはXSLのパースに失敗しました。");
            }
            
            const xsltProcessor = new XSLTProcessor();
            xsltProcessor.importStylesheet(xslDoc);
            const resultDocument = xsltProcessor.transformToFragment(xmlDoc, document);
            
            if (!resultDocument) {
                throw new Error("XSLT変換に失敗しました。");
            }

            const serializer = new XMLSerializer();
            const htmlString = serializer.serializeToString(resultDocument);

            viewer.srcdoc = htmlString;
            viewer.onload = () => {
                const body = viewer.contentDocument.body;
                // iframeの高さを内容に合わせて自動調整
                viewer.style.height = body.scrollHeight + 'px';
                showLoading(false);
            };
            
            viewerContainer.classList.remove('hidden');
        } catch(error) {
            alert(`文書の表示に失敗しました: ${error.message}`);
            viewer.srcdoc = `<p style="padding: 20px; color: red;">表示エラー</p>`;
            viewerContainer.classList.remove('hidden');
            showLoading(false);
        }
    }

    function resetUI() {
        fileNameSpan.textContent = '選択されていません';
        fileInput.value = '';
        resultSection.classList.add('hidden');
        fileListContainer.innerHTML = '';
        viewerContainer.classList.add('hidden');
    }

    function showLoading(show) {
        loadingOverlay.classList.toggle('hidden', !show);
    }
    
    // ★PDFダウンロード機能を、iframeの内容を対象にするように変更
    downloadPdfBtn.addEventListener('click', async () => {
        const iframeBody = viewer.contentDocument.body;
        if (!iframeBody || iframeBody.children.length === 0) {
            alert('表示されている文書がありません。');
            return;
        }

        showLoading(true);
        try {
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();

            const canvas = await html2canvas(iframeBody, {
                scale: 2, useCORS: true,
                windowWidth: iframeBody.scrollWidth,
                windowHeight: iframeBody.scrollHeight,
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

    // ★PNG保存機能を、iframeの内容を対象にするように変更
    downloadPngBtn.addEventListener('click', async () => {
        const iframeBody = viewer.contentDocument.body;
        if (!iframeBody || iframeBody.children.length === 0) {
            alert('表示されている文書がありません。');
            return;
        }

        showLoading(true);
        try {
            const canvas = await html2canvas(iframeBody, {
                scale: 2, useCORS: true,
                width: iframeBody.clientWidth, 
                height: (iframeBody.clientWidth / 210) * 297, // A4 aspect ratio
                windowHeight: (iframeBody.clientWidth / 210) * 297,
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

