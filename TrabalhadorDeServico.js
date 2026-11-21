/**
 * ==============================================================================
 * Trabalhador de Serviço (Service Worker) - K-Off Kanban PWA
 * Responsabilidade Única: Gerenciar o cache dos arquivos estáticos da aplicação,
 * permitir execução 100% offline via estratégia Cache First e coordenar
 * atualizações atômicas controladas pelo usuário.
 *
 * Como publicar novas versões (ex: GitHub Pages):
 * Sempre que alterar qualquer arquivo do projeto, incremente a constante
 * VERSAO_CACHE abaixo (ex: "k-off-v1.0.0" -> "k-off-v1.0.1").
 * O navegador detectará a diferença neste arquivo, baixará o novo cache em
 * segundo plano e avisará a interface para o usuário atualizar com segurança.
 * ==============================================================================
 */

const VERSAO_CACHE = "k-off-v1.1.0";

/**
 * Lista completa dos recursos estáticos essenciais para o K-Off rodar offline.
 * Todos os caminhos são relativos ("./") para funcionar tanto na raiz quanto
 * em subpastas (ex: https://usuario.github.io/pi-kanban/).
 */
const ARQUIVOS_ESTATICOS = [
    "./",
    "./index.html",
    "./manifest.json",
    "./css/estilo.css",
    "./css/icones.css",
    "./img/k-off-logo.svg",
    "./img/icone-192.png",
    "./img/icone-512.png",
    "./js/bibliotecas/dexie.js",
    "./js/bibliotecas/sortable.min.js",
    "./js/Modelo.js",
    "./js/Armazenamento.js",
    "./js/Interface.js",
    "./js/ArrastarESoltar.js",
    "./js/Inicializacao.js"
];

/**
 * Evento de Instalação (install):
 * Baixa todos os arquivos estáticos para o cache versionado atual.
 * Usamos { cache: "reload" } para garantir que o navegador busque os arquivos
 * realmente atualizados do servidor ao instalar uma nova versão, ignorando
 * eventuais caches HTTP antigos.
 *
 * IMPORTANTE: Não chamamos self.skipWaiting() aqui de propósito. Assim, se já
 * existir uma versão antiga rodando, a nova aguarda ("waiting") até o usuário
 * clicar no botão de atualização, evitando misturar scripts antigos e novos.
 */
self.addEventListener("install", (evento) => {
    evento.waitUntil(
        caches.open(VERSAO_CACHE).then((cache) => {
            const requisicoesAtualizadas = ARQUIVOS_ESTATICOS.map((caminho) => {
                return new Request(caminho, { cache: "reload" });
            });
            return cache.addAll(requisicoesAtualizadas);
        })
    );
});

/**
 * Evento de Ativação (activate):
 * Executado quando este Service Worker assume o controle.
 * Remove todos os caches de versões anteriores para não acumular lixo no disco.
 */
self.addEventListener("activate", (evento) => {
    evento.waitUntil(
        caches.keys().then((nomesDeCaches) => {
            const remocoes = nomesDeCaches.map((nomeCache) => {
                if (nomeCache !== VERSAO_CACHE) {
                    return caches.delete(nomeCache);
                }
                return Promise.resolve();
            });
            return Promise.all(remocoes);
        }).then(() => {
            // Assume imediatamente o controle das abas abertas após a ativação
            return self.clients.claim();
        })
    );
});

/**
 * Evento de Interceptação de Rede (fetch):
 * Implementa a estratégia Cache First (Cache Primeiro):
 * 1. Verifica se o arquivo já existe no cache local (ignorando parâmetros de URL
 *    como ?source=pwa para evitar falhas de correspondência no modo standalone).
 * 2. Se existir no cache, entrega imediatamente sem depender da internet.
 * 3. Se não existir no cache, busca na rede; se for uma navegação offline
 *    sem correspondência exata, entrega o "./index.html" salvo em cache.
 */
self.addEventListener("fetch", (evento) => {
    const requisicao = evento.request;

    // Intercepta apenas requisições GET do próprio protocolo HTTP/HTTPS
    if (requisicao.method !== "GET") {
        return;
    }

    const urlRequisicao = new URL(requisicao.url);
    if (urlRequisicao.origin !== self.location.origin) {
        return;
    }

    evento.respondWith(
        caches.match(requisicao, { ignoreSearch: true }).then((respostaEmCache) => {
            if (respostaEmCache) {
                return respostaEmCache;
            }

            return fetch(requisicao).then((respostaDaRede) => {
                // Só armazena respostas válidas e do mesmo domínio
                if (
                    respostaDaRede &&
                    respostaDaRede.status === 200 &&
                    respostaDaRede.type === "basic"
                ) {
                    const copiaResposta = respostaDaRede.clone();
                    caches.open(VERSAO_CACHE).then((cache) => {
                        cache.put(requisicao, copiaResposta);
                    });
                }
                return respostaDaRede;
            }).catch(() => {
                // Fallback seguro para navegações quando o dispositivo estiver offline
                if (requisicao.mode === "navigate") {
                    return caches.match("./index.html").then((resposta) => resposta || Response.error());
                }
                return Response.error();
            });
        })
    );
});

/**
 * Canal de Mensagens (message):
 * Escuta instruções enviadas pela página principal.
 * Quando o usuário confirma a atualização na interface, a página envia
 * { acao: "PULAR_ESPERA" } e o Service Worker ativa a nova versão imediatamente.
 */
self.addEventListener("message", (evento) => {
    if (evento.data && evento.data.acao === "PULAR_ESPERA") {
        self.skipWaiting();
    }
});
