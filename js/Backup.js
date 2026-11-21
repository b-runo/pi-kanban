/**
 * ==============================================================================
 * Camada de Backup e Restauração (.pkb) - K-Off Kanban
 * Responsabilidade Única: Serializar os dados do quadro em JSON minificado,
 * exportar/compartilhar arquivos .pkb (Web Share API com fallback para download)
 * e restaurar backups via FileReader ou File Handling API (launchQueue).
 * ==============================================================================
 */

class GerenciadorDeBackup {
    /**
     * Construtor da classe GerenciadorDeBackup.
     *
     * @param {BancoDeDadosLocal} bancoDeDados - Instância da camada de armazenamento.
     * @param {GerenciadorDeInterface} gerenciadorDeInterface - Instância da camada de interface.
     */
    constructor(bancoDeDados, gerenciadorDeInterface) {
        this.bancoDeDados = bancoDeDados;
        this.gerenciadorDeInterface = gerenciadorDeInterface;
    }

    /**
     * Gera um nome de arquivo padronizado com data e hora local seguras para
     * qualquer sistema de arquivos: kanban-AAAA-MM-DD_HH-mm-ss.pkb.
     *
     * @param {Date} [dataReferencia] - Data opcional para composição do nome.
     * @returns {string} Nome do arquivo com extensão .pkb.
     */
    gerarNomeArquivoBackup(dataReferencia = new Date()) {
        const preencher = (valor) => String(valor).padStart(2, "0");

        const ano = dataReferencia.getFullYear();
        const mes = preencher(dataReferencia.getMonth() + 1);
        const dia = preencher(dataReferencia.getDate());
        const hora = preencher(dataReferencia.getHours());
        const minuto = preencher(dataReferencia.getMinutes());
        const segundo = preencher(dataReferencia.getSeconds());

        return `kanban-${ano}-${mes}-${dia}_${hora}-${minuto}-${segundo}.pkb`;
    }

    /**
     * Cria um objeto File (ou Blob) contendo o JSON minificado do backup.
     *
     * @param {string} conteudoJson - Conteúdo JSON já serializado e minificado.
     * @param {string} nomeArquivo - Nome final do arquivo .pkb.
     * @param {string} [tipoMime="application/octet-stream"] - Tipo MIME do arquivo.
     * @returns {File | Blob} Arquivo pronto para compartilhamento ou download.
     */
    criarArquivoBackup(conteudoJson, nomeArquivo, tipoMime = "application/octet-stream") {
        if (typeof File === "function") {
            return new File([conteudoJson], nomeArquivo, { type: tipoMime });
        }
        return new Blob([conteudoJson], { type: tipoMime });
    }

    /**
     * Realiza o download automático do arquivo de backup criando uma URL temporária
     * em memória (URL.createObjectURL) e simulando um clique em um link invisível.
     *
     * @param {Blob | File} arquivo - Arquivo ou Blob a ser baixado.
     * @param {string} nomeArquivo - Nome sugerido para salvar no dispositivo.
     */
    baixarArquivo(arquivo, nomeArquivo) {
        const urlTemporaria = URL.createObjectURL(arquivo);
        const linkDownload = document.createElement("a");

        linkDownload.href = urlTemporaria;
        linkDownload.download = nomeArquivo;
        linkDownload.style.display = "none";

        document.body.appendChild(linkDownload);
        linkDownload.click();
        document.body.removeChild(linkDownload);

        // Pequeno atraso antes de revogar a URL para garantir início do download no Safari/iOS
        setTimeout(() => {
            URL.revokeObjectURL(urlTemporaria);
        }, 1500);
    }

    /**
     * Lê todas as tabelas do banco local, serializa em JSON minificado (.pkb) e
     * tenta compartilhar via Web Share API; caso não haja suporte ou ocorra falha
     * técnica no compartilhamento, executa o download automático como fallback.
     *
     * @returns {Promise<{metodo: "share" | "download" | "cancelado", nomeArquivo: string}>}
     */
    async exportarECompartilhar() {
        const dadosCompletos = await this.bancoDeDados.exportarTodosOsDados();
        // JSON minificado (sem espaços extras) para manter o arquivo compacto
        const jsonMinificado = JSON.stringify(dadosCompletos);
        const nomeArquivo = this.gerarNomeArquivoBackup();

        // Tenta usar Web Share API com suporte a arquivos (comum em Android, iOS e alguns desktops)
        if (typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function") {
            // Prioriza application/octet-stream para evitar que o iOS anexe ".json" ou ".txt" ao .pkb
            const tiposMimePreferenciais = ["application/octet-stream", "application/json", "text/plain"];
            let arquivoParaCompartilhar = null;
            let podeCompartilharArquivo = false;

            for (const tipoMime of tiposMimePreferenciais) {
                const candidato = this.criarArquivoBackup(jsonMinificado, nomeArquivo, tipoMime);
                if (navigator.canShare({ files: [candidato] })) {
                    arquivoParaCompartilhar = candidato;
                    podeCompartilharArquivo = true;
                    break;
                }
            }

            if (podeCompartilharArquivo) {
                try {
                    await navigator.share({
                        title: "Backup K-Off Kanban",
                        text: "Backup completo do quadro Kanban (.pkb)",
                        files: [arquivoParaCompartilhar]
                    });

                    return {
                        metodo: "share",
                        nomeArquivo: nomeArquivo
                    };
                } catch (erro) {
                    // Se o próprio usuário fechou a gaveta de compartilhamento, não força download
                    if (erro && erro.name === "AbortError") {
                        return {
                            metodo: "cancelado",
                            nomeArquivo: nomeArquivo
                        };
                    }
                    // Em outros erros (ex: desktop que bloqueou share de arquivo), cai para o download
                    console.warn("⚠️ Falha ao compartilhar via Web Share API, executando download fallback:", erro);
                }
            }
        }

        // Fallback universal: download direto via Blob URL com octet-stream para preservar a extensão .pkb no Safari iOS
        const arquivoDownload = this.criarArquivoBackup(jsonMinificado, nomeArquivo, "application/octet-stream");
        this.baixarArquivo(arquivoDownload, nomeArquivo);

        return {
            metodo: "download",
            nomeArquivo: nomeArquivo
        };
    }

    /**
     * Lê o conteúdo textual de um objeto File usando FileReader.
     * O uso explícito de FileReader garante alta compatibilidade com o Safari no iOS/iPadOS.
     *
     * @param {File} arquivo - Arquivo selecionado pelo usuário ou recebido pelo sistema.
     * @returns {Promise<string>} Conteúdo textual UTF-8 do arquivo.
     */
    lerArquivoComFileReader(arquivo) {
        return new Promise((resolver, rejeitar) => {
            if (!arquivo) {
                rejeitar(new Error("Nenhum arquivo foi selecionado para leitura."));
                return;
            }

            const leitor = new FileReader();

            leitor.onload = (evento) => {
                const resultado = evento && evento.target ? evento.target.result : "";
                resolver(typeof resultado === "string" ? resultado : "");
            };

            leitor.onerror = () => {
                rejeitar(new Error("Não foi possível ler o arquivo selecionado."));
            };

            leitor.readAsText(arquivo, "UTF-8");
        });
    }

    /**
     * Valida a estrutura mínima de um objeto de backup JSON antes da restauração.
     *
     * @param {any} dados - Objeto retornado por JSON.parse.
     * @returns {{colunas: number, cartoes: number, itens: number}} Resumo quantitativo validado.
     */
    validarEstruturaBackup(dados) {
        if (!dados || typeof dados !== "object") {
            throw new Error("O arquivo não contém um objeto de backup válido.");
        }

        const origem = (dados.dados && typeof dados.dados === "object") ? dados.dados : dados;

        if (!Array.isArray(origem.colunas) || !Array.isArray(origem.cartoes)) {
            throw new Error("O arquivo .pkb não possui a estrutura esperada (colunas e cartões).");
        }

        const totalItens = Array.isArray(origem.itens_cartao) ? origem.itens_cartao.length : 0;

        return {
            colunas: origem.colunas.length,
            cartoes: origem.cartoes.length,
            itens: totalItens
        };
    }

    /**
     * Faz o parse, valida, pede confirmação ao usuário e substitui todo o quadro
     * no IndexedDB pelos dados do backup, atualizando a interface logo em seguida.
     *
     * @param {string} conteudoTexto - Conteúdo bruto JSON lido do arquivo .pkb.
     * @param {string} [nomeArquivo="backup.pkb"] - Nome do arquivo para exibição na confirmação.
     * @returns {Promise<{restaurado: boolean, cancelado?: boolean, resumo?: {colunas: number, cartoes: number, itens: number}}>}
     */
    async importarDeTextoJson(conteudoTexto, nomeArquivo = "backup.pkb") {
        const textoLimpo = typeof conteudoTexto === "string"
            ? conteudoTexto.replace(/^\uFEFF/, "").trim()
            : "";

        if (!textoLimpo) {
            throw new Error("O arquivo selecionado está vazio.");
        }

        let dadosParseados;
        try {
            dadosParseados = JSON.parse(textoLimpo);
        } catch (erroParse) {
            throw new Error("O arquivo selecionado não é um backup .pkb válido (JSON corrompido ou formato incompatível).");
        }

        const resumoValidacao = this.validarEstruturaBackup(dadosParseados);

        const textoColunas = resumoValidacao.colunas === 1 ? "coluna" : "colunas";
        const textoCartoes = resumoValidacao.cartoes === 1 ? "cartão" : "cartões";
        const textoTarefas = resumoValidacao.itens === 1 ? "tarefa" : "tarefas";

        const mensagemConfirmacao =
            `Deseja restaurar o backup "${nomeArquivo}"?\n\n` +
            `Conteúdo encontrado: ${resumoValidacao.colunas} ${textoColunas}, ${resumoValidacao.cartoes} ${textoCartoes} e ${resumoValidacao.itens} ${textoTarefas}.\n\n` +
            `ATENÇÃO: Todo o quadro atual será substituído pelos dados deste backup.`;

        const confirmou = confirm(mensagemConfirmacao);
        if (!confirmou) {
            return {
                restaurado: false,
                cancelado: true
            };
        }

        // Substitui atomicamente as 4 tabelas do IndexedDB
        const resumoRestaurado = await this.bancoDeDados.restaurarBackupCompleto(dadosParseados);

        // Atualiza tema, título do projeto e re-renderiza todo o quadro na tela
        if (this.gerenciadorDeInterface) {
            this.gerenciadorDeInterface.cartaoAbertoAtual = null;
            this.gerenciadorDeInterface.colunaAbertaAtual = null;

            if (typeof this.gerenciadorDeInterface.carregarConfiguracoesIniciais === "function") {
                await this.gerenciadorDeInterface.carregarConfiguracoesIniciais();
            }
            if (typeof this.gerenciadorDeInterface.renderizarQuadro === "function") {
                await this.gerenciadorDeInterface.renderizarQuadro();
            }
        }

        return {
            restaurado: true,
            resumo: resumoRestaurado
        };
    }

    /**
     * Fluxo de importação manual a partir de um objeto File (input type="file").
     * Aceita extensões .pkb e .json (incluindo .pkb.json gerado anteriormente por alguns navegadores)
     * antes da leitura, pois o input não utiliza "accept" para evitar bloqueio por UTI no Safari Mobile.
     *
     * @param {File} arquivo - Arquivo .pkb ou .json selecionado pelo usuário.
     * @returns {Promise<{restaurado: boolean, cancelado?: boolean, resumo?: Object}>}
     */
    async importarDeArquivo(arquivo) {
        if (!arquivo) {
            throw new Error("Nenhum arquivo foi selecionado para importação.");
        }

        const nomeArquivo = typeof arquivo.name === "string" ? arquivo.name.trim() : "";
        if (!/\.(pkb|json)$/i.test(nomeArquivo)) {
            throw new Error("Formato inválido. Selecione um arquivo de backup com extensão .pkb ou .json.");
        }

        const conteudo = await this.lerArquivoComFileReader(arquivo);
        return await this.importarDeTextoJson(conteudo, nomeArquivo || "backup.pkb");
    }

    /**
     * Fluxo de importação automática a partir de um FileSystemFileHandle recebido
     * pela File Handling API (window.launchQueue).
     *
     * @param {FileSystemFileHandle} manipuladorArquivo - Handle do arquivo aberto pelo sistema.
     * @returns {Promise<{restaurado: boolean, cancelado?: boolean, resumo?: Object}>}
     */
    async importarDeManipuladorDeArquivo(manipuladorArquivo) {
        if (!manipuladorArquivo || typeof manipuladorArquivo.getFile !== "function") {
            throw new Error("Manipulador de arquivo inválido recebido pelo sistema.");
        }

        const arquivo = await manipuladorArquivo.getFile();
        return await this.importarDeArquivo(arquivo);
    }
}

// Expõe a classe globalmente no navegador
if (typeof window !== "undefined") {
    window.GerenciadorDeBackup = GerenciadorDeBackup;
}

// Suporte para ambientes de módulo (ex: testes unitários com Node.js)
if (typeof module !== "undefined" && module.exports) {
    module.exports = { GerenciadorDeBackup };
}
