/**
 * ==============================================================================
 * Camada de Arrastar e Soltar (Drag and Drop) - K-Off Kanban
 * Responsabilidade Única: Gerenciar a movimentação e reordenação de cartões
 * entre colunas e a reordenação de colunas no quadro utilizando SortableJS,
 * persistindo a nova estrutura no IndexedDB.
 *
 * Por que separar em um módulo próprio?
 * Seguindo o Princípio da Responsabilidade Única (SOLID), a interface cuida
 * apenas da renderização e cliques de CRUD, enquanto esta classe isola toda a
 * lógica de gestos de arraste (PC e Mobile) e cálculo de ordenação.
 * ==============================================================================
 */

class GerenciadorDeArrasto {
    /**
     * Construtor da classe GerenciadorDeArrasto.
     *
     * @param {BancoDeDadosLocal} bancoDeDados - Instância da camada de armazenamento.
     * @param {Object} [opcoes={}] - Opções adicionais de configuração.
     * @param {HTMLElement} [opcoes.containerQuadro] - Elemento raiz do quadro Kanban (#quadro).
     */
    constructor(bancoDeDados, opcoes = {}) {
        this.bancoDeDados = bancoDeDados;
        this.containerQuadro = opcoes.containerQuadro || document.getElementById("quadro");

        // Guardamos as referências das instâncias ativas do SortableJS para destruí-las
        // antes de reinicializar, evitando vazamentos de memória após re-renderizações.
        this.instanciaQuadro = null;
        this.instanciasListasCartoes = [];
    }

    /**
     * Inicializa ou reinicializa o SortableJS no quadro (para colunas) e em todas
     * as listas de cartões visíveis atualmente no DOM.
     */
    inicializar() {
        if (typeof Sortable === "undefined") {
            console.error("❌ Biblioteca SortableJS não encontrada. Verifique a importação no index.html.");
            return;
        }

        if (!this.containerQuadro) {
            this.containerQuadro = document.getElementById("quadro");
        }

        if (!this.containerQuadro) {
            return;
        }

        // Remove instâncias anteriores antes de conectar aos novos elementos do DOM
        this.destruirInstancias();

        this.inicializarArrastoDeColunas();
        this.inicializarArrastoDeCartoes();
    }

    /**
     * Destrói todas as instâncias ativas do SortableJS com segurança.
     */
    destruirInstancias() {
        if (this.instanciaQuadro) {
            this.instanciaQuadro.destroy();
            this.instanciaQuadro = null;
        }

        if (this.instanciasListasCartoes.length > 0) {
            this.instanciasListasCartoes.forEach((instancia) => {
                if (instancia && typeof instancia.destroy === "function") {
                    instancia.destroy();
                }
            });
            this.instanciasListasCartoes = [];
        }
    }

    /**
     * Configura o arrastar e soltar para reordenação de colunas no contêiner #quadro.
     */
    inicializarArrastoDeColunas() {
        const colunasValidas = this.containerQuadro.querySelectorAll(".coluna:not(.coluna-placeholder)");
        if (colunasValidas.length === 0) {
            return;
        }

        this.instanciaQuadro = new Sortable(this.containerQuadro, {
            animation: 150,
            draggable: ".coluna:not(.coluna-placeholder)",
            handle: ".cabecalho-coluna",
            // Não bloqueia eventos nativos de clique/foco nos elementos filtrados
            filter: ".coluna-placeholder, .menu-acoes-coluna, .dropdown-acoes-coluna, input, button, [contenteditable='true']",
            preventOnFilter: false,
            // No mobile, exige um toque longo (~180ms) no cabeçalho para não conflitar
            // com a rolagem horizontal do quadro ou com o toque curto que edita o título.
            delay: 180,
            delayOnTouchOnly: true,
            touchStartThreshold: 5,
            fallbackTolerance: 3,
            ghostClass: "coluna-fantasma",
            chosenClass: "coluna-selecionada",
            dragClass: "coluna-arrastando",
            // Evita que o #quadro glitche o scroll horizontal ao arrastar uma coluna para a borda da tela
            fallbackOnBody: true,
            bubbleScroll: false,
            scrollSensitivity: 55,
            scrollSpeed: 12,
            onStart: () => {
                document.body.classList.add("arrastando-elemento");
                // Fecha qualquer menu suspenso aberto na coluna antes de mover
                const menusAbertos = this.containerQuadro.querySelectorAll(".dropdown-acoes-coluna:not(.oculto)");
                menusAbertos.forEach((menu) => menu.classList.add("oculto"));
            },
            onEnd: async (evento) => {
                document.body.classList.remove("arrastando-elemento");
                await this.aoSoltarColuna(evento);
            }
        });
    }

    /**
     * Configura o arrastar e soltar de cartões em todas as listas (.lista-de-cartoes),
     * permitindo mover dentro da mesma coluna ou entre colunas diferentes.
     */
    inicializarArrastoDeCartoes() {
        const listasDeCartoes = this.containerQuadro.querySelectorAll(".coluna:not(.coluna-placeholder) .lista-de-cartoes");

        listasDeCartoes.forEach((elementoLista) => {
            const instancia = new Sortable(elementoLista, {
                // O mesmo nome de grupo permite mover cartões livremente entre colunas
                group: "cartoes-kanban",
                animation: 150,
                draggable: ".cartao",
                filter: ".aviso-sem-cartoes",
                // Toque longo no mobile: toque rápido abre o modal do cartão;
                // segurar o dedo por 180ms inicia o arrasto sem conflitar com o scroll.
                delay: 180,
                delayOnTouchOnly: true,
                touchStartThreshold: 5,
                fallbackTolerance: 3,
                ghostClass: "cartao-fantasma",
                chosenClass: "cartao-selecionado",
                dragClass: "cartao-arrastando",
                onStart: () => {
                    document.body.classList.add("arrastando-elemento");
                },
                onAdd: (evento) => {
                    // Remove imediatamente o aviso de "Nenhum cartão nesta coluna"
                    // assim que um cartão entra em uma coluna anteriormente vazia.
                    this.removerAvisoSemCartoes(evento.to);
                },
                onEnd: async (evento) => {
                    document.body.classList.remove("arrastando-elemento");
                    await this.aoSoltarCartao(evento);
                }
            });

            this.instanciasListasCartoes.push(instancia);
        });
    }

    /**
     * Manipula o fim do arrasto de uma coluna, recalculando as posições sequenciais
     * (0, 1, 2...) e persistindo no IndexedDB em lote.
     *
     * @param {Object} evento - Objeto de evento disparado pelo SortableJS.
     */
    async aoSoltarColuna(evento) {
        if (!evento || evento.oldIndex === evento.newIndex) {
            return;
        }

        try {
            const elementosColunas = Array.from(
                this.containerQuadro.querySelectorAll(".coluna:not(.coluna-placeholder)")
            );

            const alteracoesEmLote = [];

            elementosColunas.forEach((elementoColuna, indice) => {
                const idColuna = elementoColuna.dataset.identificadorColuna;
                if (idColuna) {
                    alteracoesEmLote.push({
                        id: idColuna,
                        alteracoes: { ordem: indice }
                    });
                }
            });

            if (alteracoesEmLote.length > 0) {
                await this.bancoDeDados.atualizarColunasEmLote(alteracoesEmLote);
            }
        } catch (erro) {
            console.error("Erro ao salvar nova ordem das colunas após arrastar:", erro);
        }
    }

    /**
     * Manipula o fim do arrasto de um cartão, identificando o ID do cartão,
     * a coluna de destino e recalculando a ordem nas listas envolvidas.
     *
     * @param {Object} evento - Objeto de evento disparado pelo SortableJS.
     */
    async aoSoltarCartao(evento) {
        if (!evento) {
            return;
        }

        const listaOrigem = evento.from;
        const listaDestino = evento.to;
        const elementoCartao = evento.item;

        // Se o cartão foi solto exatamente no mesmo lugar, não há nada para persistir
        if (listaOrigem === listaDestino && evento.oldIndex === evento.newIndex) {
            return;
        }

        const idCartao = elementoCartao ? elementoCartao.dataset.id : null;
        const idColunaDestino = listaDestino ? listaDestino.dataset.identificadorColuna : null;

        if (!idCartao || !idColunaDestino) {
            console.warn("Não foi possível identificar o cartão ou a coluna de destino no onEnd.");
            return;
        }

        // Garante consistência visual dos avisos de coluna vazia na origem e no destino
        this.removerAvisoSemCartoes(listaDestino);
        if (listaOrigem && listaOrigem !== listaDestino) {
            this.garantirAvisoSemCartoesSeVazia(listaOrigem);
        }

        try {
            const alteracoesEmLote = [];

            // 1. Reindexa todos os cartões presentes na coluna de destino (0, 1, 2...)
            const cartoesDestino = Array.from(listaDestino.querySelectorAll(".cartao"));
            cartoesDestino.forEach((cartaoEl, indice) => {
                const idAtual = cartaoEl.dataset.id;
                if (!idAtual) return;

                if (idAtual === idCartao) {
                    alteracoesEmLote.push({
                        id: idAtual,
                        alteracoes: {
                            colunaAtual: idColunaDestino,
                            ordem: indice
                        }
                    });
                } else {
                    alteracoesEmLote.push({
                        id: idAtual,
                        alteracoes: {
                            ordem: indice
                        }
                    });
                }
            });

            // 2. Se houve mudança de coluna, reindexa os cartões restantes na coluna de origem
            if (listaOrigem && listaOrigem !== listaDestino) {
                const cartoesOrigem = Array.from(listaOrigem.querySelectorAll(".cartao"));
                cartoesOrigem.forEach((cartaoEl, indice) => {
                    const idAtual = cartaoEl.dataset.id;
                    if (!idAtual) return;

                    alteracoesEmLote.push({
                        id: idAtual,
                        alteracoes: {
                            ordem: indice
                        }
                    });
                });
            }

            // 3. Persiste todas as atualizações de forma atômica em uma única transação no IndexedDB
            if (alteracoesEmLote.length > 0) {
                await this.bancoDeDados.atualizarCartoesEmLote(alteracoesEmLote);
            }
        } catch (erro) {
            console.error(`Erro ao salvar movimentação do cartão ${idCartao} no IndexedDB:`, erro);
        }
    }

    /**
     * Remove o elemento de aviso de coluna vazia caso exista na lista informada.
     *
     * @param {HTMLElement} elementoLista - Elemento .lista-de-cartoes.
     */
    removerAvisoSemCartoes(elementoLista) {
        if (!elementoLista) return;
        const avisoVazio = elementoLista.querySelector(".aviso-sem-cartoes");
        if (avisoVazio) {
            avisoVazio.remove();
        }
    }

    /**
     * Insere o aviso de coluna vazia na lista informada se não restar nenhum cartão nela.
     *
     * @param {HTMLElement} elementoLista - Elemento .lista-de-cartoes.
     */
    garantirAvisoSemCartoesSeVazia(elementoLista) {
        if (!elementoLista) return;
        const possuiCartoes = elementoLista.querySelectorAll(".cartao").length > 0;
        const jaPossuiAviso = Boolean(elementoLista.querySelector(".aviso-sem-cartoes"));

        if (!possuiCartoes && !jaPossuiAviso) {
            const avisoSemCartoes = document.createElement("div");
            avisoSemCartoes.className = "aviso-sem-cartoes";
            avisoSemCartoes.textContent = "Nenhum cartão nesta coluna";
            elementoLista.appendChild(avisoSemCartoes);
        }
    }
}

// Expõe a classe globalmente no navegador
if (typeof window !== "undefined") {
    window.GerenciadorDeArrasto = GerenciadorDeArrasto;
}

// Suporte para ambientes de módulo (ex: testes unitários com Node.js)
if (typeof module !== "undefined" && module.exports) {
    module.exports = { GerenciadorDeArrasto };
}
