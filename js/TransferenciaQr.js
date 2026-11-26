/**
 * ==============================================================================
 * Camada de Transferência via QR Code - K-Off Kanban
 * Responsabilidade Única: Serializar o quadro em JSON minificado, fatiar em
 * fragmentos identificados por sessão (protocolo KOFF), exibir o carrossel
 * de QR Codes no dispositivo emissor e ler/remontar os fragmentos via câmera
 * (html5-qrcode) no dispositivo receptor com restauração atômica no banco.
 * ==============================================================================
 */

const PREFIXO_PROTOCOLO_QR = "KOFF";
const TAMANHO_MAXIMO_FRAGMENTO_BYTES = 280;
const INTERVALO_CARROSSEL_PADRAO_MS = 750;
const INTERVALO_CARROSSEL_MINIMO_MS = 250;
const INTERVALO_CARROSSEL_MAXIMO_MS = 3000;
const NIVEL_CORRECAO_QR_PADRAO = "M";

class GerenciadorDeTransferenciaQr {
    /**
     * Construtor da classe GerenciadorDeTransferenciaQr.
     *
     * @param {BancoDeDadosLocal} bancoDeDados - Instância da camada de armazenamento.
     * @param {GerenciadorDeBackup | null} [gerenciadorDeBackup=null] - Instância do gerenciador de backup.
     * @param {GerenciadorDeInterface | null} [gerenciadorDeInterface=null] - Instância da interface DOM.
     */
    constructor(bancoDeDados, gerenciadorDeBackup = null, gerenciadorDeInterface = null) {
        this.bancoDeDados = bancoDeDados;
        this.gerenciadorDeBackup = gerenciadorDeBackup;
        this.gerenciadorDeInterface = gerenciadorDeInterface;

        // Estado interno do Emissor (carrossel de QR Codes)
        this.temporizadorCarrossel = null;
        this.emissaoAtiva = false;
        this.emissaoPausada = false;
        this.fragmentosEmissao = [];
        this.indiceAtualEmissao = 0;
        this.idSessaoEmissao = "";
        this.intervaloCarrosselMs = INTERVALO_CARROSSEL_PADRAO_MS;
        this.nivelCorrecaoQr = NIVEL_CORRECAO_QR_PADRAO;
        this.containerQrEmissor = null;
        this.callbackEstadoEmissor = null;

        // Estado interno do Receptor (leitura contínua via câmera)
        this.leitorQrInstancia = null;
        this.idContainerLeitor = "";
        this.leituraAtiva = false;
        this.finalizandoLeitura = false;
        this.tokenInicializacaoLeitura = 0;
        this.idSessaoRecepcao = null;
        this.totalPartesRecepcao = 0;
        this.fragmentosRecebidos = new Map();
        this.callbackProgressoRecepcao = null;
        this.callbackConclusaoRecepcao = null;
        this.callbackErroRecepcao = null;
        this.callbackEstadoRecepcao = null;
    }

    /**
     * Gera um identificador curto de sessão para impedir mistura de fragmentos
     * caso o emissor reinicie ou altere o quadro durante uma transferência.
     *
     * @returns {string} Código alfanumérico curto em minúsculas (ex: "k9x4m").
     */
    gerarIdSessao() {
        const parteTempo = Date.now().toString(36).slice(-3);
        const parteAleatoria = Math.random().toString(36).slice(2, 5);
        return `${parteTempo}${parteAleatoria}`;
    }

    /**
     * Calcula a quantidade exata de bytes UTF-8 de uma string.
     * Necessário porque QR Codes limitam o conteúdo em bytes (não em caracteres UTF-16),
     * especialmente importante para textos em português com acentos e emojis.
     *
     * @param {string} texto - Texto a medir.
     * @returns {number} Quantidade de bytes UTF-8.
     */
    calcularBytesUtf8(texto) {
        if (typeof TextEncoder === "function") {
            return new TextEncoder().encode(texto).length;
        }
        // Fallback compatível para ambientes sem TextEncoder
        return unescape(encodeURIComponent(texto)).length;
    }

    /**
     * Divide uma string em pedaços respeitando o limite máximo em bytes UTF-8
     * e preservando pares substitutos (emojis e caracteres Unicode completos).
     *
     * @param {string} texto - Texto completo (JSON minificado).
     * @param {number} [tamanhoMaximoBytes=280] - Limite de bytes por fragmento.
     * @returns {string[]} Lista ordenada de fragmentos de texto.
     */
    fatiarTextoPorBytesUtf8(texto, tamanhoMaximoBytes = TAMANHO_MAXIMO_FRAGMENTO_BYTES) {
        if (typeof texto !== "string" || texto.length === 0) {
            return [];
        }

        const limiteSeguro = Math.max(32, Number(tamanhoMaximoBytes) || TAMANHO_MAXIMO_FRAGMENTO_BYTES);
        const fragmentos = [];
        let blocoAtual = "";
        let bytesNoBlocoAtual = 0;

        // Iterar com for...of percorre pontos de código Unicode completos (sem quebrar emojis)
        for (const caractere of texto) {
            const bytesCaractere = this.calcularBytesUtf8(caractere);

            if (bytesNoBlocoAtual + bytesCaractere > limiteSeguro && blocoAtual.length > 0) {
                fragmentos.push(blocoAtual);
                blocoAtual = caractere;
                bytesNoBlocoAtual = bytesCaractere;
            } else {
                blocoAtual += caractere;
                bytesNoBlocoAtual += bytesCaractere;
            }
        }

        if (blocoAtual.length > 0) {
            fragmentos.push(blocoAtual);
        }

        return fragmentos;
    }

    /**
     * Empacota o JSON minificado em fragmentos seguindo o protocolo:
     * KOFF|<idSessao>|<indice>/<total>|<conteudo>
     *
     * @param {string} textoJson - JSON minificado do quadro Kanban.
     * @param {string} [idSessao] - Identificador da sessão de emissão.
     * @param {number} [tamanhoMaximoBytes=280] - Limite de bytes do conteúdo por QR Code.
     * @returns {{idSessao: string, totalPartes: number, tamanhoTotalBytes: number, fragmentos: string[]}}
     */
    criarFragmentosProtocolo(
        textoJson,
        idSessao = this.gerarIdSessao(),
        tamanhoMaximoBytes = TAMANHO_MAXIMO_FRAGMENTO_BYTES
    ) {
        if (typeof textoJson !== "string" || textoJson.trim().length === 0) {
            throw new Error("Não há dados serializados para gerar os QR Codes.");
        }

        const pedacos = this.fatiarTextoPorBytesUtf8(textoJson, tamanhoMaximoBytes);
        const totalPartes = pedacos.length;

        const fragmentos = pedacos.map((pedaco, indiceBaseZero) => {
            const numeroParte = indiceBaseZero + 1;
            return `${PREFIXO_PROTOCOLO_QR}|${idSessao}|${numeroParte}/${totalPartes}|${pedaco}`;
        });

        return {
            idSessao,
            totalPartes,
            tamanhoTotalBytes: this.calcularBytesUtf8(textoJson),
            fragmentos
        };
    }

    /**
     * Interpreta e valida uma string lida de um QR Code no formato do protocolo KOFF.
     * Usa busca dos três primeiros separadores "|" para preservar qualquer "|" presente
     * dentro do conteúdo JSON dos cartões.
     *
     * @param {string} textoLido - Conteúdo bruto lido do QR Code.
     * @returns {{valido: boolean, idSessao?: string, indice?: number, total?: number, conteudo?: string, motivo?: string}}
     */
    analisarFragmentoProtocolo(textoLido) {
        if (typeof textoLido !== "string" || textoLido.length === 0) {
            return { valido: false, motivo: "QR Code vazio." };
        }

        const primeiroSep = textoLido.indexOf("|");
        if (primeiroSep === -1) {
            return { valido: false, motivo: "Formato não reconhecido pelo K-Off." };
        }

        const prefixo = textoLido.slice(0, primeiroSep);
        if (prefixo !== PREFIXO_PROTOCOLO_QR) {
            return { valido: false, motivo: "QR Code não pertence a uma transferência do K-Off." };
        }

        const segundoSep = textoLido.indexOf("|", primeiroSep + 1);
        const terceiroSep = segundoSep !== -1 ? textoLido.indexOf("|", segundoSep + 1) : -1;
        if (segundoSep === -1 || terceiroSep === -1) {
            return { valido: false, motivo: "Cabeçalho de fragmento incompleto." };
        }

        const idSessao = textoLido.slice(primeiroSep + 1, segundoSep).trim();
        const parteMetadado = textoLido.slice(segundoSep + 1, terceiroSep).trim();
        const conteudo = textoLido.slice(terceiroSep + 1);

        if (!/^[a-z0-9]{3,16}$/i.test(idSessao)) {
            return { valido: false, motivo: "Identificador de sessão inválido." };
        }

        const correspondenciaParte = /^(\d+)\/(\d+)$/.exec(parteMetadado);
        if (!correspondenciaParte) {
            return { valido: false, motivo: "Numeração de parte inválida." };
        }

        const indice = Number(correspondenciaParte[1]);
        const total = Number(correspondenciaParte[2]);

        if (!Number.isInteger(indice) || !Number.isInteger(total) || total < 1 || indice < 1 || indice > total) {
            return { valido: false, motivo: "Índice de parte fora do intervalo." };
        }

        return {
            valido: true,
            idSessao,
            indice,
            total,
            conteudo
        };
    }

    /**
     * Obtém a função geradora da biblioteca qrcode-generator garantindo suporte a UTF-8.
     *
     * @returns {Function} Função `qrcode(typeNumber, errorCorrectionLevel)`.
     */
    obterBibliotecaGeradoraQr() {
        let gerador = null;

        if (typeof window !== "undefined" && typeof window.qrcode === "function") {
            gerador = window.qrcode;
        } else if (typeof qrcode === "function") {
            gerador = qrcode;
        } else if (typeof require === "function") {
            try {
                gerador = require("./bibliotecas/qrcode.min.js");
            } catch (erroRequire) {
                gerador = null;
            }
        }

        if (typeof gerador !== "function") {
            throw new Error("Biblioteca geradora de QR Code não carregada.");
        }

        // Ativa codificação UTF-8 para suportar acentos e emojis em português sem erros
        if (gerador.stringToBytesFuncs && typeof gerador.stringToBytesFuncs["UTF-8"] === "function") {
            gerador.stringToBytes = gerador.stringToBytesFuncs["UTF-8"];
        }

        return gerador;
    }

    /**
     * Gera a marcação SVG vetorial de um QR Code com fundo branco sólido e
     * margem de silêncio (quiet zone) fixa para leitura confiável mesmo no tema escuro.
     *
     * @param {string} conteudoFragmento - Texto do fragmento a codificar.
     * @param {string} [nivelCorrecao="M"] - Nível de correção de erro ("L", "M", "Q", "H").
     * @returns {string} String SVG pronta para inserção no container.
     */
    gerarSvgQrCode(conteudoFragmento, nivelCorrecao = this.nivelCorrecaoQr) {
        const gerador = this.obterBibliotecaGeradoraQr();
        const nivelValido = ["L", "M", "Q", "H"].includes(nivelCorrecao)
            ? nivelCorrecao
            : NIVEL_CORRECAO_QR_PADRAO;

        // typeNumber = 0 permite escolha automática da menor versão de QR que comporta os dados
        const codigoQr = gerador(0, nivelValido);
        codigoQr.addData(conteudoFragmento, "Byte");
        codigoQr.make();

        // margin = 16 com cellSize = 4 garante 4 módulos de borda branca ao redor do código
        return codigoQr.createSvgTag({
            cellSize: 4,
            margin: 16,
            scalable: true
        });
    }

    /**
     * Lê todos os dados atuais do banco local, serializa em JSON minificado
     * e prepara os fragmentos prontos para emissão.
     *
     * @param {number} [tamanhoMaximoBytes=280] - Limite de bytes por fragmento.
     * @returns {Promise<{idSessao: string, totalPartes: number, tamanhoTotalBytes: number, fragmentos: string[]}>}
     */
    async prepararDadosParaEmissao(tamanhoMaximoBytes = TAMANHO_MAXIMO_FRAGMENTO_BYTES) {
        if (!this.bancoDeDados || typeof this.bancoDeDados.exportarTodosOsDados !== "function") {
            throw new Error("Camada de armazenamento indisponível para gerar o QR Code.");
        }

        const dadosCompletos = await this.bancoDeDados.exportarTodosOsDados();
        const jsonMinificado = JSON.stringify(dadosCompletos);

        return this.criarFragmentosProtocolo(
            jsonMinificado,
            this.gerarIdSessao(),
            tamanhoMaximoBytes
        );
    }

    /**
     * Renderiza no DOM o fragmento atualmente selecionado pelo índice do carrossel
     * e notifica o callback de atualização de estado.
     */
    renderizarFragmentoAtual() {
        if (!this.emissaoAtiva || this.fragmentosEmissao.length === 0) {
            return;
        }

        const fragmento = this.fragmentosEmissao[this.indiceAtualEmissao];

        if (this.containerQrEmissor) {
            const svgQr = this.gerarSvgQrCode(fragmento, this.nivelCorrecaoQr);
            this.containerQrEmissor.innerHTML = svgQr;

            const elementoSvg = this.containerQrEmissor.querySelector("svg");
            if (elementoSvg) {
                elementoSvg.setAttribute(
                    "aria-label",
                    `QR Code parte ${this.indiceAtualEmissao + 1} de ${this.fragmentosEmissao.length}`
                );
                elementoSvg.setAttribute("role", "img");
            }
        }

        this.notificarEstadoEmissor();
    }

    /**
     * Limpa o temporizador atual do carrossel, se existir.
     */
    limparTemporizadorCarrossel() {
        if (this.temporizadorCarrossel !== null) {
            clearInterval(this.temporizadorCarrossel);
            this.temporizadorCarrossel = null;
        }
    }

    /**
     * Inicia ou reinicia o `setInterval` responsável por alternar os QR Codes
     * quando o quadro foi dividido em múltiplas partes.
     */
    iniciarTemporizadorCarrossel() {
        this.limparTemporizadorCarrossel();

        if (!this.emissaoAtiva || this.emissaoPausada || this.fragmentosEmissao.length <= 1) {
            return;
        }

        this.temporizadorCarrossel = setInterval(() => {
            if (!this.emissaoAtiva || this.emissaoPausada || this.fragmentosEmissao.length <= 1) {
                return;
            }
            this.indiceAtualEmissao = (this.indiceAtualEmissao + 1) % this.fragmentosEmissao.length;
            this.renderizarFragmentoAtual();
        }, this.intervaloCarrosselMs);
    }

    /**
     * Inicia a emissão do quadro atual em QR Code (único ou carrossel rápido).
     *
     * @param {object} [opcoes={}] - Configurações da sessão de emissão.
     * @param {HTMLElement | null} [opcoes.containerQr=null] - Elemento onde o SVG será renderizado.
     * @param {Function | null} [opcoes.aoAtualizarEstado=null] - Callback chamado a cada troca de quadro.
     * @param {number} [opcoes.intervaloMs=750] - Intervalo do carrossel em milissegundos.
     * @param {number} [opcoes.tamanhoFragmentoBytes=280] - Tamanho máximo por fragmento em bytes UTF-8.
     * @param {string} [opcoes.nivelCorrecao="M"] - Nível de correção de erro do QR Code.
     * @returns {Promise<{idSessao: string, totalPartes: number, tamanhoTotalBytes: number}>}
     */
    async iniciarEmissao(opcoes = {}) {
        // Garante que qualquer emissão anterior seja encerrada antes de começar uma nova
        this.encerrarEmissao();

        const intervaloSolicitado = Number(opcoes.intervaloMs) || INTERVALO_CARROSSEL_PADRAO_MS;
        this.intervaloCarrosselMs = Math.min(
            INTERVALO_CARROSSEL_MAXIMO_MS,
            Math.max(INTERVALO_CARROSSEL_MINIMO_MS, intervaloSolicitado)
        );
        this.nivelCorrecaoQr = opcoes.nivelCorrecao || NIVEL_CORRECAO_QR_PADRAO;
        this.containerQrEmissor = opcoes.containerQr || null;
        this.callbackEstadoEmissor = typeof opcoes.aoAtualizarEstado === "function"
            ? opcoes.aoAtualizarEstado
            : null;

        const pacote = await this.prepararDadosParaEmissao(opcoes.tamanhoFragmentoBytes);

        this.fragmentosEmissao = pacote.fragmentos;
        this.idSessaoEmissao = pacote.idSessao;
        this.indiceAtualEmissao = 0;
        this.emissaoAtiva = true;
        this.emissaoPausada = false;

        this.renderizarFragmentoAtual();
        this.iniciarTemporizadorCarrossel();

        return {
            idSessao: pacote.idSessao,
            totalPartes: pacote.totalPartes,
            tamanhoTotalBytes: pacote.tamanhoTotalBytes
        };
    }

    /**
     * Pausa a rotação automática do carrossel mantendo o QR Code atual visível.
     */
    pausarEmissao() {
        if (!this.emissaoAtiva || this.emissaoPausada) {
            return;
        }
        this.emissaoPausada = true;
        this.limparTemporizadorCarrossel();
        this.notificarEstadoEmissor();
    }

    /**
     * Retoma a rotação automática do carrossel a partir do fragmento atual.
     */
    retomarEmissao() {
        if (!this.emissaoAtiva || !this.emissaoPausada) {
            return;
        }
        this.emissaoPausada = false;
        this.iniciarTemporizadorCarrossel();
        this.notificarEstadoEmissor();
    }

    /**
     * Alterna entre pausa e execução contínua do carrossel.
     *
     * @returns {boolean} Retorna `true` se o carrossel ficou pausado.
     */
    alternarPausaEmissao() {
        if (this.emissaoPausada) {
            this.retomarEmissao();
        } else {
            this.pausarEmissao();
        }
        return this.emissaoPausada;
    }

    /**
     * Avança manualmente para o próximo fragmento do carrossel.
     */
    avancarFragmentoEmissao() {
        if (!this.emissaoAtiva || this.fragmentosEmissao.length <= 1) {
            return;
        }
        this.indiceAtualEmissao = (this.indiceAtualEmissao + 1) % this.fragmentosEmissao.length;
        this.renderizarFragmentoAtual();
        if (!this.emissaoPausada) {
            this.iniciarTemporizadorCarrossel();
        }
    }

    /**
     * Retorna manualmente para o fragmento anterior do carrossel.
     */
    voltarFragmentoEmissao() {
        if (!this.emissaoAtiva || this.fragmentosEmissao.length <= 1) {
            return;
        }
        this.indiceAtualEmissao = (
            this.indiceAtualEmissao - 1 + this.fragmentosEmissao.length
        ) % this.fragmentosEmissao.length;
        this.renderizarFragmentoAtual();
        if (!this.emissaoPausada) {
            this.iniciarTemporizadorCarrossel();
        }
    }

    /**
     * Ajusta a velocidade de troca do carrossel em tempo real.
     *
     * @param {number} novoIntervaloMs - Novo intervalo em milissegundos.
     */
    alterarVelocidadeEmissao(novoIntervaloMs) {
        const valorNormalizado = Math.min(
            INTERVALO_CARROSSEL_MAXIMO_MS,
            Math.max(INTERVALO_CARROSSEL_MINIMO_MS, Number(novoIntervaloMs) || INTERVALO_CARROSSEL_PADRAO_MS)
        );
        this.intervaloCarrosselMs = valorNormalizado;

        if (this.emissaoAtiva && !this.emissaoPausada) {
            this.iniciarTemporizadorCarrossel();
        }
        this.notificarEstadoEmissor();
    }

    /**
     * Envia o resumo atualizado do estado do Emissor para a camada de interface.
     */
    notificarEstadoEmissor() {
        if (typeof this.callbackEstadoEmissor !== "function") {
            return;
        }

        const totalPartes = this.fragmentosEmissao.length;
        this.callbackEstadoEmissor({
            ativo: this.emissaoAtiva,
            pausado: this.emissaoPausada,
            idSessao: this.idSessaoEmissao,
            indiceAtual: this.indiceAtualEmissao,
            numeroParteAtual: totalPartes > 0 ? this.indiceAtualEmissao + 1 : 0,
            totalPartes,
            intervaloMs: this.intervaloCarrosselMs
        });
    }

    /**
     * Encerra a emissão, limpa o temporizador do carrossel e remove o QR Code da tela.
     */
    encerrarEmissao() {
        this.limparTemporizadorCarrossel();
        this.emissaoAtiva = false;
        this.emissaoPausada = false;
        this.fragmentosEmissao = [];
        this.indiceAtualEmissao = 0;
        this.idSessaoEmissao = "";

        if (this.containerQrEmissor) {
            this.containerQrEmissor.innerHTML = "";
        }

        this.notificarEstadoEmissor();
        this.containerQrEmissor = null;
        this.callbackEstadoEmissor = null;
    }

    /**
     * ==========================================================================
     * RECEPTOR (Leitura via câmera com html5-qrcode, remontagem e restauração)
     * ==========================================================================
     */

    /**
     * Obtém a classe Html5Qrcode e os formatos suportados da biblioteca local.
     *
     * @returns {{ClasseLeitor: Function, formatosSuportados: Object | null}}
     */
    obterBibliotecaLeitoraQr() {
        let ClasseLeitor = null;
        let formatosSuportados = null;

        if (typeof window !== "undefined") {
            ClasseLeitor = window.Html5Qrcode || null;
            formatosSuportados = window.Html5QrcodeSupportedFormats || null;
        } else if (typeof Html5Qrcode === "function") {
            ClasseLeitor = Html5Qrcode;
            formatosSuportados = typeof Html5QrcodeSupportedFormats !== "undefined"
                ? Html5QrcodeSupportedFormats
                : null;
        }

        if (typeof ClasseLeitor !== "function") {
            throw new Error("Biblioteca leitora de QR Code (html5-qrcode) não carregada.");
        }

        return { ClasseLeitor, formatosSuportados };
    }

    /**
     * Verifica pré-requisitos do navegador para uso da câmera, tratando
     * principalmente restrições de contexto seguro no Safari iOS e Android.
     */
    verificarSuporteCamera() {
        if (typeof window !== "undefined" && window.isSecureContext === false) {
            throw new Error("O acesso à câmera exige conexão segura (HTTPS) ou localhost.");
        }

        if (
            typeof navigator === "undefined"
            || !navigator.mediaDevices
            || typeof navigator.mediaDevices.getUserMedia !== "function"
        ) {
            throw new Error("Este navegador ou contexto não permite acessar a câmera.");
        }
    }

    /**
     * Converte erros técnicos de câmera/getUserMedia em mensagens claras em português.
     *
     * @param {any} erro - Erro retornado pelo navegador ou pela html5-qrcode.
     * @returns {string} Mensagem amigável para exibição na interface.
     */
    traduzirErroCamera(erro) {
        const nome = erro && erro.name ? String(erro.name) : "";
        const mensagemOriginal = typeof erro === "string"
            ? erro
            : (erro && erro.message ? String(erro.message) : "");
        const textoCombinado = `${nome} ${mensagemOriginal}`.toLowerCase();

        if (
            nome === "NotAllowedError"
            || nome === "PermissionDeniedError"
            || textoCombinado.includes("permission")
            || textoCombinado.includes("notallowed")
        ) {
            return "Permissão da câmera negada. Libere o acesso à câmera nas configurações do navegador e tente novamente.";
        }

        if (
            nome === "NotFoundError"
            || nome === "DevicesNotFoundError"
            || textoCombinado.includes("notfound")
            || textoCombinado.includes("no camera")
        ) {
            return "Nenhuma câmera foi encontrada neste dispositivo.";
        }

        if (
            nome === "NotReadableError"
            || nome === "TrackStartError"
            || textoCombinado.includes("notreadable")
            || textoCombinado.includes("in use")
        ) {
            return "A câmera já está em uso por outro aplicativo ou aba.";
        }

        if (nome === "OverconstrainedError" || textoCombinado.includes("overconstrained")) {
            return "Não foi possível iniciar a câmera com a configuração solicitada.";
        }

        return mensagemOriginal || "Não foi possível ativar a câmera para ler o QR Code.";
    }

    /**
     * Garante os atributos necessários no elemento <video> para impedir que o Safari
     * no iPhone/iPad abra o stream da câmera em reprodutor nativo tela cheia.
     *
     * @param {string} idContainer - ID do contêiner onde o leitor foi montado.
     */
    aplicarAtributosVideoSafariIos(idContainer) {
        if (typeof document === "undefined" || !idContainer) {
            return;
        }
        const container = document.getElementById(idContainer);
        if (!container) {
            return;
        }

        const elementosVideo = container.querySelectorAll("video");
        elementosVideo.forEach((video) => {
            video.playsInline = true;
            video.muted = true;
            video.setAttribute("playsinline", "true");
            video.setAttribute("webkit-playsinline", "true");
            video.setAttribute("muted", "true");
        });
    }

    /**
     * Reinicia os acumuladores de fragmentos recebidos da sessão atual.
     */
    resetarEstadoRecepcao() {
        this.idSessaoRecepcao = null;
        this.totalPartesRecepcao = 0;
        this.fragmentosRecebidos.clear();
        this.finalizandoLeitura = false;
    }

    /**
     * Inicia a câmera e o escaneamento contínuo de QR Codes para receber um quadro.
     *
     * @param {object} [opcoes={}] - Configurações e callbacks da leitura.
     * @param {string} opcoes.idContainerLeitor - ID do elemento DOM para o preview da câmera.
     * @param {Function | null} [opcoes.aoAtualizarProgresso=null] - Callback de progresso por parte lida.
     * @param {Function | null} [opcoes.aoConcluir=null] - Callback chamado após restaurar o quadro.
     * @param {Function | null} [opcoes.aoOcorrerErro=null] - Callback para erros de leitura/restauração.
     * @param {Function | null} [opcoes.aoMudarEstado=null] - Callback quando câmera ativa/inativa.
     */
    async iniciarLeitura(opcoes = {}) {
        const tokenSolicitacao = this.tokenInicializacaoLeitura + 1;
        this.tokenInicializacaoLeitura = tokenSolicitacao;

        await this.encerrarLeitura(false);

        if (tokenSolicitacao !== this.tokenInicializacaoLeitura) {
            return;
        }

        const idContainer = typeof opcoes.idContainerLeitor === "string"
            ? opcoes.idContainerLeitor.trim()
            : "";

        if (!idContainer) {
            throw new Error("Contêiner do leitor de QR Code não informado.");
        }

        this.verificarSuporteCamera();
        const { ClasseLeitor, formatosSuportados } = this.obterBibliotecaLeitoraQr();

        this.resetarEstadoRecepcao();
        this.idContainerLeitor = idContainer;
        this.callbackProgressoRecepcao = typeof opcoes.aoAtualizarProgresso === "function"
            ? opcoes.aoAtualizarProgresso
            : null;
        this.callbackConclusaoRecepcao = typeof opcoes.aoConcluir === "function"
            ? opcoes.aoConcluir
            : null;
        this.callbackErroRecepcao = typeof opcoes.aoOcorrerErro === "function"
            ? opcoes.aoOcorrerErro
            : null;
        this.callbackEstadoRecepcao = typeof opcoes.aoMudarEstado === "function"
            ? opcoes.aoMudarEstado
            : null;

        const opcoesInstancia = { verbose: false };
        if (formatosSuportados && formatosSuportados.QR_CODE !== undefined) {
            opcoesInstancia.formatsToSupport = [formatosSuportados.QR_CODE];
        }

        const leitor = new ClasseLeitor(idContainer, opcoesInstancia);
        this.leitorQrInstancia = leitor;

        // Não fixamos aspectRatio para evitar OverconstrainedError em lentes múltiplas do Safari iOS
        const configuracaoLeitura = {
            fps: 12,
            qrbox: (larguraViewfinder, alturaViewfinder) => {
                const menorLado = Math.min(larguraViewfinder, alturaViewfinder);
                const tamanhoCaixa = Math.max(180, Math.floor(menorLado * 0.78));
                return { width: tamanhoCaixa, height: tamanhoCaixa };
            },
            disableFlip: false
        };

        const aoDecodificar = (textoDecodificado) => {
            this.processarTextoQrLido(textoDecodificado);
        };

        const aoFalharFrame = () => {
            // Falhas por frame sem QR visível são normais durante o escaneamento contínuo
        };

        const leituraFoiAbortada = () =>
            tokenSolicitacao !== this.tokenInicializacaoLeitura
            || !this.leituraAtiva
            || this.leitorQrInstancia !== leitor;

        const limparLeitorAbortado = async () => {
            try {
                if (typeof leitor.stop === "function") {
                    await leitor.stop();
                }
            } catch (erroStopAbortado) {
                // Ignora se a câmera ainda não havia completado a inicialização
            }
            try {
                if (typeof leitor.clear === "function") {
                    leitor.clear();
                }
            } catch (erroClearAbortado) {
                // Ignora erro silencioso de limpeza
            }
        };

        try {
            // Ativa leitura antes do start para garantir que callbacks iniciais funcionem se necessário
            this.leituraAtiva = true;

            try {
                await leitor.start(
                    { facingMode: "environment" },
                    configuracaoLeitura,
                    aoDecodificar,
                    aoFalharFrame
                );
            } catch (erroPreferenciaTraseira) {
                if (leituraFoiAbortada()) {
                    await limparLeitorAbortado();
                    return;
                }

                const mensagemErro = this.traduzirErroCamera(erroPreferenciaTraseira);
                const foiPermissaoNegada = erroPreferenciaTraseira
                    && (erroPreferenciaTraseira.name === "NotAllowedError"
                        || erroPreferenciaTraseira.name === "PermissionDeniedError");

                if (foiPermissaoNegada || typeof ClasseLeitor.getCameras !== "function") {
                    throw new Error(mensagemErro);
                }

                // Fallback para Desktop (webcam frontal) ou dispositivos onde facingMode falha
                const camerasDisponiveis = await ClasseLeitor.getCameras();
                if (leituraFoiAbortada()) {
                    await limparLeitorAbortado();
                    return;
                }

                if (!Array.isArray(camerasDisponiveis) || camerasDisponiveis.length === 0) {
                    throw new Error("Nenhuma câmera disponível foi encontrada.");
                }

                const cameraTraseira = camerasDisponiveis.find((cam) =>
                    /back|rear|traseira|environment/i.test(cam.label || "")
                );
                const cameraEscolhida = cameraTraseira || camerasDisponiveis[camerasDisponiveis.length - 1];

                await leitor.start(
                    cameraEscolhida.id,
                    configuracaoLeitura,
                    aoDecodificar,
                    aoFalharFrame
                );
            }

            // Se o usuário fechou o modal enquanto a permissão/câmera abria, libera o hardware imediatamente
            if (leituraFoiAbortada()) {
                await limparLeitorAbortado();
                return;
            }

            this.aplicarAtributosVideoSafariIos(idContainer);
            this.notificarEstadoRecepcao(true);
        } catch (erroInicio) {
            if (leituraFoiAbortada()) {
                await limparLeitorAbortado();
                return;
            }
            this.leituraAtiva = false;
            await this.encerrarLeitura();
            throw new Error(this.traduzirErroCamera(erroInicio));
        }
    }

    /**
     * Monta o resumo atual de progresso da recepção (partes lidas e faltantes).
     *
     * @param {number | null} [ultimaParteLida=null] - Número da última parte capturada.
     * @returns {{tipo: string, idSessao: string | null, recebidas: number, total: number, percentual: number, partesRecebidas: number[], partesFaltantes: number[], ultimaParteLida: number | null}}
     */
    obterResumoProgressoRecepcao(ultimaParteLida = null) {
        const total = this.totalPartesRecepcao;
        const partesRecebidas = [];
        const partesFaltantes = [];

        for (let indice = 1; indice <= total; indice += 1) {
            if (this.fragmentosRecebidos.has(indice)) {
                partesRecebidas.push(indice);
            } else {
                partesFaltantes.push(indice);
            }
        }

        const recebidas = partesRecebidas.length;
        const percentual = total > 0 ? Math.round((recebidas / total) * 100) : 0;

        return {
            tipo: "progresso",
            idSessao: this.idSessaoRecepcao,
            recebidas,
            total,
            percentual,
            partesRecebidas,
            partesFaltantes,
            ultimaParteLida
        };
    }

    /**
     * Processa cada texto decodificado pela câmera: valida o cabeçalho KOFF,
     * gerencia troca de sessão, armazena partes únicas e dispara conclusão
     * assim que todas as partes forem capturadas.
     *
     * @param {string} textoLido - String bruta decodificada do QR Code.
     * @returns {Promise<{aceito: boolean, concluido?: boolean, duplicado?: boolean, motivo?: string, resumo?: Object} | null>}
     */
    async processarTextoQrLido(textoLido) {
        if (!this.leituraAtiva || this.finalizandoLeitura) {
            return null;
        }

        const analise = this.analisarFragmentoProtocolo(textoLido);
        if (!analise.valido) {
            if (this.callbackProgressoRecepcao) {
                this.callbackProgressoRecepcao({
                    ...this.obterResumoProgressoRecepcao(null),
                    tipo: "ignorado",
                    motivo: analise.motivo
                });
            }
            return { aceito: false, motivo: analise.motivo };
        }

        // Se o emissor reiniciou ou mudou o quadro, reinicia a coleta para a nova sessão
        if (
            this.idSessaoRecepcao !== analise.idSessao
            || this.totalPartesRecepcao !== analise.total
        ) {
            this.fragmentosRecebidos.clear();
            this.idSessaoRecepcao = analise.idSessao;
            this.totalPartesRecepcao = analise.total;
        }

        if (this.fragmentosRecebidos.has(analise.indice)) {
            return {
                aceito: true,
                duplicado: true,
                resumo: this.obterResumoProgressoRecepcao(analise.indice)
            };
        }

        this.fragmentosRecebidos.set(analise.indice, analise.conteudo);
        const resumo = this.obterResumoProgressoRecepcao(analise.indice);

        if (this.callbackProgressoRecepcao) {
            this.callbackProgressoRecepcao(resumo);
        }

        if (resumo.recebidas === resumo.total && resumo.total > 0) {
            // Trava imediatamente antes de operações assíncronas para evitar execução dupla
            this.finalizandoLeitura = true;
            const resultadoConclusao = await this.concluirRecepcao();
            return {
                aceito: true,
                concluido: true,
                resumo,
                resultado: resultadoConclusao
            };
        }

        return {
            aceito: true,
            concluido: false,
            duplicado: false,
            resumo
        };
    }

    /**
     * Concatena todos os fragmentos recebidos na ordem exata `1..total`.
     *
     * @returns {string} JSON completo remontado.
     */
    montarJsonDasPartesRecebidas() {
        if (this.totalPartesRecepcao < 1 || this.fragmentosRecebidos.size !== this.totalPartesRecepcao) {
            throw new Error("Nem todas as partes do QR Code foram recebidas.");
        }

        const partesOrdenadas = [];
        for (let indice = 1; indice <= this.totalPartesRecepcao; indice += 1) {
            const pedaco = this.fragmentosRecebidos.get(indice);
            if (typeof pedaco !== "string") {
                throw new Error(`Parte ${indice} ausente ao montar os dados recebidos.`);
            }
            partesOrdenadas.push(pedaco);
        }

        return partesOrdenadas.join("");
    }

    /**
     * Faz o parse do JSON remontado, valida a estrutura e salva atomicamente
     * no IndexedDB, re-renderizando a interface do quadro em seguida.
     *
     * @param {string} jsonCompleto - JSON completo reconstituído dos QR Codes.
     * @returns {Promise<{restaurado: boolean, cancelado?: boolean, resumo?: Object}>}
     */
    async restaurarDadosRecebidos(jsonCompleto) {
        if (this.gerenciadorDeBackup && typeof this.gerenciadorDeBackup.importarDeTextoJson === "function") {
            return await this.gerenciadorDeBackup.importarDeTextoJson(
                jsonCompleto,
                "Transferência via QR Code"
            );
        }

        let dadosParseados;
        try {
            dadosParseados = JSON.parse(jsonCompleto);
        } catch (erroParse) {
            throw new Error("Os dados recebidos via QR Code não formam um JSON válido.");
        }

        if (!this.bancoDeDados || typeof this.bancoDeDados.restaurarBackupCompleto !== "function") {
            throw new Error("Camada de armazenamento indisponível para restaurar os dados.");
        }

        const resumoRestaurado = await this.bancoDeDados.restaurarBackupCompleto(dadosParseados);

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
     * Finaliza a captura: remonta o JSON, desliga a câmera imediatamente para
     * liberar o hardware antes de diálogos, persiste os dados e notifica a UI.
     *
     * @returns {Promise<Object>}
     */
    async concluirRecepcao() {
        const aoConcluir = this.callbackConclusaoRecepcao;
        const aoOcorrerErro = this.callbackErroRecepcao;

        try {
            const jsonCompleto = this.montarJsonDasPartesRecebidas();

            // Desliga a câmera antes da confirmação/restauração para liberar o dispositivo
            await this.encerrarLeitura();

            const resultado = await this.restaurarDadosRecebidos(jsonCompleto);
            if (typeof aoConcluir === "function") {
                aoConcluir(resultado);
            }
            return resultado;
        } catch (erroConclusao) {
            await this.encerrarLeitura();
            if (typeof aoOcorrerErro === "function") {
                aoOcorrerErro(erroConclusao);
            }
            throw erroConclusao;
        }
    }

    /**
     * Notifica o callback de mudança de estado da câmera do Receptor.
     *
     * @param {boolean} ativo - Indica se a câmera está em leitura ativa.
     */
    notificarEstadoRecepcao(ativo) {
        if (typeof this.callbackEstadoRecepcao === "function") {
            this.callbackEstadoRecepcao({ ativo: Boolean(ativo) });
        }
    }

    /**
     * Encerra a câmera do leitor de QR Code com segurança e limpa o estado de recepção.
     */
    async encerrarLeitura(invalidarInicializacao = true) {
        if (invalidarInicializacao) {
            this.tokenInicializacaoLeitura += 1;
        }

        const leitor = this.leitorQrInstancia;
        const callbackEstado = this.callbackEstadoRecepcao;
        const estavaAtivo = this.leituraAtiva || Boolean(leitor);

        this.leituraAtiva = false;
        this.leitorQrInstancia = null;

        if (leitor) {
            try {
                if (typeof leitor.stop === "function") {
                    await leitor.stop();
                }
            } catch (erroStop) {
                // Ignora erro caso a câmera já estivesse parada ou não tenha iniciado
            }

            try {
                if (typeof leitor.clear === "function") {
                    leitor.clear();
                }
            } catch (erroClear) {
                // Ignora falha silenciosa de limpeza visual do contêiner
            }
        }

        this.resetarEstadoRecepcao();

        if (estavaAtivo && typeof callbackEstado === "function") {
            callbackEstado({ ativo: false });
        }

        this.idContainerLeitor = "";
        this.callbackProgressoRecepcao = null;
        this.callbackConclusaoRecepcao = null;
        this.callbackErroRecepcao = null;
        this.callbackEstadoRecepcao = null;
    }

    /**
     * Encerra qualquer transferência ativa (emissão em carrossel e leitura de câmera).
     * Deve ser chamado sempre que o usuário fechar o modal ou sair da tela de transferência.
     */
    async encerrarTransferencia() {
        this.encerrarEmissao();
        await this.encerrarLeitura();
    }
}

// Expõe a classe globalmente no navegador
if (typeof window !== "undefined") {
    window.GerenciadorDeTransferenciaQr = GerenciadorDeTransferenciaQr;
}

// Suporte para ambientes de módulo (ex: testes unitários com Node.js)
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        GerenciadorDeTransferenciaQr,
        PREFIXO_PROTOCOLO_QR,
        TAMANHO_MAXIMO_FRAGMENTO_BYTES,
        INTERVALO_CARROSSEL_PADRAO_MS
    };
}
