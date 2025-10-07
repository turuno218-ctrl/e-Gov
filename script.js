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
                    // Find file ending with the specified name, ignoring paths
                    const xslFile = Object.values(zip.files).find(e => !e.dir && e.name.toLowerCase().endsWith(xslFileName.toLowerCase().replace(/\\/g, '/').split('/').pop()));
                    if (xslFile) return { 
                        name: xmlFile.name, 
                        xml: xmlContent,
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

    // iframeへの文書表示ロジック
    function displayDocument(index) {
        const pair = documentPairs[index];
        originalFileName = pair.name.replace(/\.xml$/i, '');
        showLoading(true);

        const displayPromise = new Promise((resolve, reject) => {
            try {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(pair.xml, "application/xml");
                const xslDoc = parser.parseFromString(pair.xsl, "application/xml");
                if (xmlDoc.getElementsByTagName("parsererror").length || xslDoc.getElementsByTagName("parsererror").length) {
                    return reject(new Error("XMLまたはXSLのパースに失敗しました。"));
                }
                
                const xsltProcessor = new XSLTProcessor();
                xsltProcessor.importStylesheet(xslDoc);
                const resultDocument = xsltProcessor.transformToDocument(xmlDoc);
                
                if (!resultDocument) {
                    return reject(new Error("XSLT変換に失敗しました。"));
                }
                
                const serializer = new XMLSerializer();
                const htmlString = serializer.serializeToString(resultDocument);

                viewer.src = "about:blank";
                viewer.onload = () => {
                    const iDoc = viewer.contentWindow.document;
                    iDoc.open();
                    iDoc.write(htmlString);
                    iDoc.close();
                    
                    // レンダリング完了を待ってから高さを調整し、スタイルを上書き
                    setTimeout(() => {
                        const body = iDoc.body;
                        if (body) {
                            // ★★★ここからが修正箇所★★★
                            // 問題となる特定のpreタグのスタイルを強制的に上書きする
                            const problematicElements = body.querySelectorAll('pre.oshirase');
                            problematicElements.forEach(el => {
                                el.style.whiteSpace = 'pre-wrap'; // 自動で折り返すスタイル
                                el.style.wordBreak = 'break-all';  // はみ出さないように強制改行
                            });
                            // ★★★ここまでが修正箇所★★★

                            viewer.style.height = body.scrollHeight + 'px';
                        }
                        resolve();
                    }, 150); 
                };
                viewerContainer.classList.remove('hidden');

            } catch(error) {
                reject(error);
            }
        });

        displayPromise
            .then(() => showLoading(false))
            .catch(error => {
                alert(`文書の表示に失敗しました: ${error.message}`);
                viewer.src = "about:blank";
                viewer.contentWindow.document.write(`<p style="padding: 20px; color: red;">表示エラー</p>`);
                viewerContainer.classList.remove('hidden');
                showLoading(false);
            });
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
    
    // PDF/PNGダウンロード機能
    async function downloadAs(type) {
        const iframeDoc = viewer.contentDocument;
        if (!iframeDoc || !iframeDoc.body || iframeDoc.body.children.length === 0) {
            alert('表示されている文書がありません。');
            return;
        }

        showLoading(true);
        try {
            const targetElement = iframeDoc.documentElement;
            const canvas = await html2canvas(targetElement, {
                scale: 2,
                useCORS: true,
                width: targetElement.scrollWidth,
                height: targetElement.scrollHeight,
                windowWidth: targetElement.scrollWidth,
                windowHeight: targetElement.scrollHeight,
            });

            if (type === 'pdf') {
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF('p', 'mm', 'a4');
                const pdfWidth = pdf.internal.pageSize.getWidth();
                const pdfHeight = pdf.internal.pageSize.getHeight();
    
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
                    pdf.addImage(pageCanvas.toDataURL('image/png', 0.98), 'PNG', 0, 0, pdfWidth, pdfHeight);
                    currentHeight += pageHeightInCanvas;
                }
                pdf.save(`${originalFileName}.pdf`);
            } else { // PNG
                const link = document.createElement('a');
                link.download = `${originalFileName}_page1.png`;
                link.href = canvas.toDataURL('image/png', 0.98);
                link.click();
            }

        } catch (err) {
            console.error(`${type.toUpperCase()}生成エラー:`, err);
            alert(`${type.toUpperCase()}の生成に失敗しました。\nエラー: ${err.message || '不明なエラー'}`);
        } finally {
            showLoading(false);
        }
    }

    downloadPdfBtn.addEventListener('click', () => downloadAs('pdf'));
    downloadPngBtn.addEventListener('click', () => downloadAs('png'));
});

