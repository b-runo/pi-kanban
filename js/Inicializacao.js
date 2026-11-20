/**
 * ==============================================================================
 * Inicialização do Sistema - K-Off Kanban
 * Responsabilidade Única: Ponto de entrada para inicialização dos serviços
 * fundamentais da aplicação (persistência e armazenamento).
 * 
 * Por que solicitar armazenamento persistente logo no início?
 * Dispositivos móveis (iOS Safari, Android Chrome) podem liberar espaço em disco
 * excluindo automaticamente bancos de dados IndexedDB de aplicativos web caso o
 * usuário não os abra por alguns dias ou o disco fique cheio.
 * A API navigator.storage.persist() solicita explicitamente ao navegador que proteja
 * os dados do aplicativo contra limpeza automática.
 * ==============================================================================
 */

/**
 * Solicita que o navegador garanta que os dados locais não serão apagados automaticamente.
 * 
 * @returns {Promise<boolean>} Retorna verdadeiro se a persistência foi concedida.
 */
async function solicitarArmazenamentoPersistente() {
    if (navigator.storage && navigator.storage.persist) {
        try {
            const persistido = await navigator.storage.persist();
            if (persistido) {
                console.log("✅ Sistema garantiu: os dados do Kanban não serão apagados!");
            } else {
                // O popup deve aparecer quando estiver instalado no dispositivo como PWA.
                // Verificar se o app está instalado como PWA, senão mostrar mensagem para instalar como PWA.
                console.warn("⚠️ Armazenamento persistente recusado. O sistema pode limpar o app se o disco encher.");
            }
            return persistido;
        } catch (erro) {
            console.error("Erro ao solicitar armazenamento persistente:", erro);
            return false;
        }
    } else {
        console.info("ℹ️ A API de armazenamento persistente não é suportada neste navegador.");
        return false;
    }
}

/**
 * Registra o Service Worker (TrabalhadorDeServico.js) e configura a detecção
 * de novas versões publicadas (ex: GitHub Pages), mantendo a estratégia
 * Cache First com aviso amigável para atualização controlada pelo usuário.
 *
 * @param {GerenciadorDeInterface} gerenciadorDeInterface - Controlador da interface para exibir o aviso.
 */
async function registrarTrabalhadorDeServico(gerenciadorDeInterface) {
    if (!("serviceWorker" in navigator)) {
        console.info("ℹ️ Service Worker não é suportado neste navegador.");
        return;
    }

    try {
        // { updateViaCache: "none" } evita que o cache HTTP (ex: max-age=600 do GitHub Pages)
        // atrase a detecção de atualizações do arquivo TrabalhadorDeServico.js.
        const registro = await navigator.serviceWorker.register("./TrabalhadorDeServico.js", {
            updateViaCache: "none"
        });

        let jaTinhaControlador = Boolean(navigator.serviceWorker.controller);
        let recarregamentoEmAndamento = false;

        // Quando o novo Service Worker assumir o controle, recarrega a página
        // para garantir que todos os módulos carreguem da mesma versão do cache.
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (!jaTinhaControlador) {
                // Na primeira instalação não há versão anterior em uso; não precisa recarregar
                jaTinhaControlador = true;
                return;
            }

            if (recarregamentoEmAndamento) {
                return;
            }

            recarregamentoEmAndamento = true;
            window.location.reload();
        });

        const notificarNovaVersao = (trabalhadorEmEspera) => {
            if (!trabalhadorEmEspera || !gerenciadorDeInterface) {
                return;
            }

            gerenciadorDeInterface.exibirAvisoAtualizacao(() => {
                trabalhadorEmEspera.postMessage({ acao: "PULAR_ESPERA" });
            });
        };

        // Caso já exista uma atualização baixada em espera de uma visita anterior
        if (registro.waiting && navigator.serviceWorker.controller) {
            notificarNovaVersao(registro.waiting);
        }

        // Escuta novas versões detectadas pelo navegador em segundo plano
        registro.addEventListener("updatefound", () => {
            const novoTrabalhador = registro.installing;
            if (!novoTrabalhador) {
                return;
            }

            novoTrabalhador.addEventListener("statechange", () => {
                // Só exibe o aviso de atualização quando todos os arquivos novos
                // terminarem de ser salvos no cache e já houver uma versão ativa rodando.
                if (novoTrabalhador.state === "installed" && navigator.serviceWorker.controller) {
                    notificarNovaVersao(novoTrabalhador);
                }
            });
        });

        // Intervalo mínimo entre checagens automáticas ao alternar janelas/abas (1 minuto)
        const INTERVALO_MINIMO_CHECAGEM_MS = 60 * 1000;
        let ultimaChecagemAtualizacao = Date.now();

        const verificarAtualizacao = (forcar = false) => {
            if (!navigator.onLine) {
                return;
            }

            // Se já houver uma nova versão baixada aguardando confirmação, garante a exibição do aviso
            if (registro.waiting && navigator.serviceWorker.controller) {
                notificarNovaVersao(registro.waiting);
                return;
            }

            const agora = Date.now();
            if (!forcar && (agora - ultimaChecagemAtualizacao) < INTERVALO_MINIMO_CHECAGEM_MS) {
                return;
            }

            ultimaChecagemAtualizacao = agora;
            registro.update().catch((erro) => {
                console.warn("⚠️ Não foi possível verificar atualizações do Service Worker:", erro);
            });
        };

        // Quando o usuário recuperar a conexão com a internet, verifica imediatamente
        window.addEventListener("online", () => {
            verificarAtualizacao(true);
        });

        // Quando o PWA minimizado (macOS, iOS, Desktop) volta ao primeiro plano, checa atualizações
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                verificarAtualizacao(false);
            }
        });

        // Cobre restauração a partir do BFCache (comum no Safari do iOS e macOS)
        window.addEventListener("pageshow", (evento) => {
            if (evento.persisted) {
                verificarAtualizacao(false);
            }
        });

        console.log("⚙️ Trabalhador de Serviço registrado com sucesso.");
    } catch (erro) {
        console.error("❌ Erro ao registrar o Trabalhador de Serviço:", erro);
    }
}

/**
 * Verifica se o aplicativo está sendo executado como PWA já instalado (modo standalone)
 * tanto no padrão W3C (Android/Desktop) quanto no Safari iOS.
 *
 * @returns {boolean} Verdadeiro se estiver rodando fora da aba comum do navegador.
 */
function estaRodandoComoPwa() {
    const modoStandalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    const modoStandaloneIos = window.navigator.standalone === true;
    return Boolean(modoStandalone || modoStandaloneIos);
}

/**
 * Identifica dispositivos iOS/iPadOS (incluindo iPads que se identificam como MacIntel com toque).
 *
 * @returns {boolean} Verdadeiro se for iPhone, iPad ou iPod.
 */
function ehDispositivoIos() {
    const agente = window.navigator.userAgent || "";
    const iosClassico = /iphone|ipad|ipod/i.test(agente);
    const ipadModerno = window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1;
    return iosClassico || ipadModerno;
}

/**
 * Configura a detecção de instalação do PWA e controla o FAB de instalação:
 * - Se já estiver instalado (standalone), mantém o botão oculto.
 * - Em Android/Desktop (Chromium), intercepta `beforeinstallprompt` para disparar no clique.
 * - Em iOS Safari (sem suporte a `beforeinstallprompt`), exibe instrução manual no clique.
 * - Ao concluir a instalação (`appinstalled`), oculta o FAB e reforça `storage.persist()`.
 *
 * @param {GerenciadorDeInterface} gerenciadorDeInterface - Controlador da interface.
 */
function configurarInstalacaoPwa(gerenciadorDeInterface) {
    if (!gerenciadorDeInterface) {
        return;
    }

    if (estaRodandoComoPwa()) {
        gerenciadorDeInterface.ocultarBotaoInstalacao();
        return;
    }

    let eventoInstalacaoPendente = null;

    window.addEventListener("beforeinstallprompt", (evento) => {
        // Impede o mini-infobar automático para usar o nosso botão FAB controlado
        evento.preventDefault();
        eventoInstalacaoPendente = evento;

        gerenciadorDeInterface.exibirBotaoInstalacao(async () => {
            if (!eventoInstalacaoPendente) {
                return;
            }

            eventoInstalacaoPendente.prompt();
            try {
                const escolha = await eventoInstalacaoPendente.userChoice;
                if (escolha && escolha.outcome === "accepted") {
                    gerenciadorDeInterface.ocultarBotaoInstalacao();
                }
            } catch (erro) {
                console.warn("⚠️ Não foi possível concluir o prompt de instalação:", erro);
            } finally {
                eventoInstalacaoPendente = null;
            }
        });
    });

    window.addEventListener("appinstalled", async () => {
        eventoInstalacaoPendente = null;
        gerenciadorDeInterface.ocultarBotaoInstalacao();
        console.log("✅ K-Off instalado como PWA com sucesso!");

        // Após instalado, o navegador tem maior propensão a aceitar persistência permanente
        await solicitarArmazenamentoPersistente();
    });

    if (window.matchMedia) {
        const consultaStandalone = window.matchMedia("(display-mode: standalone)");
        const aoMudarDisplay = (evento) => {
            if (evento.matches) {
                gerenciadorDeInterface.ocultarBotaoInstalacao();
            }
        };

        if (typeof consultaStandalone.addEventListener === "function") {
            consultaStandalone.addEventListener("change", aoMudarDisplay);
        }
    }

    // Fallback para Safari no iOS/iPadOS, que não dispara beforeinstallprompt
    if (ehDispositivoIos()) {
        gerenciadorDeInterface.exibirBotaoInstalacao(() => {
            gerenciadorDeInterface.exibirInstrucaoInstalacaoIos();
        });
    }
}

/**
 * Função principal de inicialização da aplicação.
 */
async function inicializarAplicacao() {
    console.log("🚀 Inicializando K-Off Kanban...");

    // 1. Solicita armazenamento persistente
    await solicitarArmazenamentoPersistente();

    // 2. Cria a instância do Banco de Dados Local
    if (typeof BancoDeDadosLocal !== "undefined") {
        window.bancoDeDadosLocal = new BancoDeDadosLocal();
        console.log("📦 Banco de dados local inicializado com sucesso.");
    } else {
        console.error("❌ Classe BancoDeDadosLocal não encontrada. Verifique os scripts carregados.");
        return;
    }

    // 3. Cria o Gerenciador de Interface (Fase 3: DOM e CRUD) e o Gerenciador de Arrasto (Fase 4)
    if (typeof GerenciadorDeInterface !== "undefined") {
        window.gerenciadorDeInterface = new GerenciadorDeInterface(window.bancoDeDadosLocal);

        if (typeof GerenciadorDeArrasto !== "undefined") {
            window.gerenciadorDeArrasto = new GerenciadorDeArrasto(window.bancoDeDadosLocal);
            window.gerenciadorDeInterface.definirCallbackPosRenderizacao(() => {
                window.gerenciadorDeArrasto.inicializar();
            });
            console.log("🧲 Gerenciador de Arrasto configurado com sucesso.");
        } else {
            console.warn("⚠️ Classe GerenciadorDeArrasto não encontrada. O arrastar e soltar estará desativado.");
        }

        await window.gerenciadorDeInterface.inicializar();
        console.log("🖥️ Gerenciador de Interface inicializado com sucesso.");

        // 4. Registra o Service Worker (Fase 5: PWA Offline e detecção de atualizações)
        await registrarTrabalhadorDeServico(window.gerenciadorDeInterface);

        // 5. Configura o botão FAB e avisos de instalação do PWA
        configurarInstalacaoPwa(window.gerenciadorDeInterface);
    } else {
        console.error("❌ Classe GerenciadorDeInterface não encontrada. Verifique os scripts carregados.");
    }
}

// Executa a inicialização quando o DOM estiver pronto
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inicializarAplicacao);
} else {
    inicializarAplicacao();
}
