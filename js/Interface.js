/**
 * ==============================================================================
 * Camada de Interface (DOM) e Controle de Apresentação - K-Off Kanban
 * Responsabilidade Única: Manipular os elementos do DOM, renderizar as colunas
 * e tarefas virtualmente com foco em performance e capturar as interações
 * do usuário (CRUD).
 *
 * Princípios e Otimizações de Performance aplicados:
 * - Renderização Virtual com DocumentFragment: As colunas e cartões são montados
 *   em memória antes de serem anexados ao DOM real, evitando reflows e repaints múltiplos.
 * - Indexação Hash / Map: Mapeamento em O(1) dos cartões por coluna, garantindo
 *   tempo de montagem linear O(C + T), onde C é número de colunas e T é o total de tarefas.
 * - Delegação de Eventos: Apenas ouvintes de eventos centralizados no contêiner
 *   do quadro, evitando a criação excessiva de listeners na memória para cada botão.
 * - Responsabilidade Única (SOLID): Esta classe não cuida da persistência nem da
 *   regra de modelagem do dado; ela apenas orquestra a apresentação e os eventos.
 * ==============================================================================
 */

class GerenciadorDeInterface {
    /**
     * Construtor da classe GerenciadorDeInterface.
     *
     * @param {BancoDeDadosLocal} bancoDeDados - Instância da camada de armazenamento.
     */
    constructor(bancoDeDados) {
        // Armazenamos a referência ao banco de dados para realizar consultas e atualizações
        this.bancoDeDados = bancoDeDados;

        // Elementos estáticos da interface
        this.containerQuadro = document.getElementById("quadro");
        this.botaoAdicionarColuna = document.getElementById("botao-adicionar-coluna");

        // Elementos do Modal Popup de Detalhes do Cartão
        this.modalCartao = document.getElementById("modal-cartao");
        this.modalColuna = document.getElementById("modal-cartao-coluna");
        this.modalColunaSelect = document.getElementById("modal-cartao-coluna-select");
        this.modalTitulo = document.getElementById("modal-cartao-titulo");
        this.modalDataEntrega = document.getElementById("modal-cartao-data-entrega");
        this.modalPrioridade = document.getElementById("modal-cartao-prioridade");
        this.modalDescricao = document.getElementById("modal-cartao-descricao");
        this.modalBotaoAdicionarTarefa = document.getElementById("modal-botao-adicionar-tarefa");
        this.modalListaTarefas = document.getElementById("modal-lista-tarefas");
        this.modalBotaoFechar = document.getElementById("modal-botao-fechar");
        this.modalBotaoExcluir = document.getElementById("modal-botao-excluir");
        this.modalBotaoConcluir = document.getElementById("modal-botao-concluir");
        this.modalSecaoTarefas = document.querySelector(".secao-tarefas");

        // Estado do cartão atualmente aberto no popup
        this.cartaoAbertoAtual = null;
        this.colunaAbertaAtual = null;
    }

    /**
     * Inicializa os ouvintes de eventos da interface e renderiza o estado inicial do quadro.
     */
    inicializar() {
        this.configurarOuvintesDeEventos();
        this.configurarOuvintesModal();
        this.renderizarQuadro();
    }

    /**
     * Configura os ouvintes de eventos centralizados utilizando a técnica de Delegação de Eventos.
     * Essa técnica poupa memória e garante que elementos criados dinamicamente reajam aos cliques.
     */
    configurarOuvintesDeEventos() {
        // Botão no topo da página para adicionar nova coluna
        if (this.botaoAdicionarColuna) {
            this.botaoAdicionarColuna.addEventListener("click", () => {
                this.solicitarNovaColuna();
            });
        }

        // Delegação de eventos no contêiner do quadro para todos os botões dinâmicos
        if (this.containerQuadro) {
            this.containerQuadro.addEventListener("click", async (evento) => {
                const elementoAlvo = evento.target;

                // 1. Botão para adicionar a primeira coluna (quando o quadro está vazio)
                const botaoPrimeiraColuna = elementoAlvo.closest(".botao-adicionar-primeira-coluna");
                if (botaoPrimeiraColuna) {
                    await this.solicitarNovaColuna();
                    return;
                }

                // 2. Botão de adicionar cartão em uma coluna
                const botaoAdicionarCartao = elementoAlvo.closest(".botao-adicionar-cartao");
                if (botaoAdicionarCartao) {
                    const idColuna = botaoAdicionarCartao.dataset.idColuna;
                    if (idColuna) {
                        await this.solicitarNovoCartao(idColuna);
                    }
                    return;
                }

                // 3. Botão do menu de ações da coluna (toggle do dropdown)
                const botaoMenuAcoes = elementoAlvo.closest(".botao-menu-acoes-coluna");
                if (botaoMenuAcoes) {
                    evento.stopPropagation();
                    const containerMenu = botaoMenuAcoes.closest(".menu-acoes-coluna");
                    const dropdown = containerMenu ? containerMenu.querySelector(".dropdown-acoes-coluna") : null;
                    if (dropdown) {
                        const estaAberto = !dropdown.classList.contains("oculto");
                        this.fecharTodosMenusAcoesColuna();
                        if (!estaAberto) {
                            dropdown.classList.remove("oculto");
                            botaoMenuAcoes.setAttribute("aria-expanded", "true");
                        }
                    }
                    return;
                }

                // 4. Botão de excluir coluna (dentro do menu de ações)
                const botaoExcluirColuna = elementoAlvo.closest(".botao-excluir-coluna");
                if (botaoExcluirColuna) {
                    evento.stopPropagation();
                    this.fecharTodosMenusAcoesColuna();
                    const idColuna = botaoExcluirColuna.dataset.idColuna;
                    const tituloColuna = botaoExcluirColuna.dataset.tituloColuna || "esta coluna";

                    const confirmou = confirm(`Deseja realmente excluir a coluna "${tituloColuna}" e todos os seus cartões?`);
                    if (confirmou && idColuna) {
                        await this.excluirColuna(idColuna);
                    }
                    return;
                }

                // 4. Botão de excluir cartão
                const botaoExcluirCartao = elementoAlvo.closest(".botao-excluir-cartao");
                if (botaoExcluirCartao) {
                    evento.stopPropagation();
                    const idCartao = botaoExcluirCartao.dataset.idCartao;
                    const tituloCartao = botaoExcluirCartao.dataset.tituloCartao || "este cartão";

                    const confirmou = confirm(`Deseja realmente excluir o cartão "${tituloCartao}"?`);
                    if (confirmou && idCartao) {
                        await this.excluirCartao(idCartao);
                    }
                    return;
                }

                // 5. Clique no título da coluna para torná-lo editável
                const elementoTituloColuna = elementoAlvo.closest(".cabecalho-coluna h2");
                if (elementoTituloColuna) {
                    this.tornarTituloColunaEditavel(elementoTituloColuna);
                    return;
                }

                // 6. Clique no próprio cartão para abrir o popup com detalhes e subtarefas
                const elementoCartao = elementoAlvo.closest(".cartao");
                if (elementoCartao) {
                    const idCartao = elementoCartao.dataset.id;
                    if (idCartao) {
                        await this.abrirModalCartao(idCartao);
                    }
                    return;
                }
            });
        }

        // Fechar todos os menus de ações de coluna ao clicar fora deles no documento
        document.addEventListener("click", (evento) => {
            if (!evento.target.closest(".menu-acoes-coluna")) {
                this.fecharTodosMenusAcoesColuna();
            }
        });
    }

    /**
     * Fecha todos os menus suspensos de ações de coluna abertos no quadro.
     */
    fecharTodosMenusAcoesColuna() {
        if (!this.containerQuadro) return;
        const dropdownsAbertos = this.containerQuadro.querySelectorAll(".dropdown-acoes-coluna:not(.oculto)");
        dropdownsAbertos.forEach((dropdown) => {
            dropdown.classList.add("oculto");
            const container = dropdown.closest(".menu-acoes-coluna");
            if (container) {
                const botaoMenu = container.querySelector(".botao-menu-acoes-coluna");
                if (botaoMenu) {
                    botaoMenu.setAttribute("aria-expanded", "false");
                }
            }
            const seletorCor = dropdown.querySelector(".container-seletor-cor-dropdown");
            if (seletorCor) {
                seletorCor.classList.add("oculto");
            }
            const botaoCor = dropdown.querySelector(".botao-cor-destaque-coluna");
            if (botaoCor) {
                botaoCor.setAttribute("aria-expanded", "false");
            }
        });
    }

    /**
     * Configura os ouvintes de eventos do Modal Popup de edição de cartão e tarefas.
     */
    configurarOuvintesModal() {
        // Fechar ao clicar no botão '×'
        if (this.modalBotaoFechar) {
            this.modalBotaoFechar.addEventListener("click", () => {
                this.fecharModalCartao();
            });
        }

        // Concluir / Fechar ao clicar no botão 'Concluir'
        if (this.modalBotaoConcluir) {
            this.modalBotaoConcluir.addEventListener("click", () => {
                this.fecharModalCartao();
            });
        }

        // Excluir cartão pelo botão do rodapé do modal
        if (this.modalBotaoExcluir) {
            this.modalBotaoExcluir.addEventListener("click", async () => {
                if (!this.cartaoAbertoAtual) return;

                if (this.cartaoAbertoAtual._isNovo) {
                    this.fecharModalCartao();
                    return;
                }

                const tituloCartao = this.cartaoAbertoAtual.titulo || "este cartão";
                const confirmou = confirm(`Deseja realmente excluir o cartão "${tituloCartao}"?`);
                if (confirmou && this.cartaoAbertoAtual.id) {
                    const idCartao = this.cartaoAbertoAtual.id;
                    this.fecharModalCartao();
                    await this.excluirCartao(idCartao);
                }
            });
        }

        // Fechar ao clicar fora da caixa branca (no fundo translúcido)
        if (this.modalCartao) {
            this.modalCartao.addEventListener("click", (evento) => {
                if (evento.target === this.modalCartao) {
                    this.fecharModalCartao();
                }
            });
        }

        // Fechar ao pressionar a tecla ESC no teclado
        document.addEventListener("keydown", (evento) => {
            if (evento.key === "Escape" && this.modalCartao && !this.modalCartao.classList.contains("oculto")) {
                this.fecharModalCartao();
            }
        });

        // Alternar para select ao clicar no span da coluna (estilo inline)
        if (this.modalColuna) {
            const ativarEdicaoColuna = async () => {
                if (!this.cartaoAbertoAtual) return;
                await this.abrirSeletorColunaInline();
            };

            this.modalColuna.addEventListener("click", ativarEdicaoColuna);
            this.modalColuna.addEventListener("keydown", (evento) => {
                if (evento.key === "Enter" || evento.key === " ") {
                    evento.preventDefault();
                    ativarEdicaoColuna();
                }
            });
        }

        // Ouvintes do select inline de coluna
        if (this.modalColunaSelect) {
            this.modalColunaSelect.addEventListener("change", async () => {
                await this.alterarColunaCartaoAberto(this.modalColunaSelect.value);
            });

            this.modalColunaSelect.addEventListener("blur", () => {
                this.fecharSeletorColunaInline();
            });

            this.modalColunaSelect.addEventListener("keydown", (evento) => {
                if (evento.key === "Escape") {
                    evento.stopPropagation();
                    this.fecharSeletorColunaInline();
                }
            });
        }

        // Atualizar Título do cartão
        if (this.modalTitulo) {
            this.modalTitulo.addEventListener("change", async () => {
                if (!this.cartaoAbertoAtual) return;
                const novoTitulo = this.modalTitulo.value.trim();
                if (novoTitulo) {
                    this.cartaoAbertoAtual.titulo = novoTitulo;
                    if (this.cartaoAbertoAtual._isNovo) {
                        if (this.modalPrioridade) {
                            this.cartaoAbertoAtual.prioridade = this.modalPrioridade.value;
                        }
                        await this.bancoDeDados.salvarCartoes(this.cartaoAbertoAtual);
                        await this.verificarCartaoNovoCriado();
                    } else {
                        await this.bancoDeDados.atualizarPropriedadesCartao(this.cartaoAbertoAtual.id, {
                            titulo: novoTitulo
                        });
                    }
                } else if (!this.cartaoAbertoAtual._isNovo) {
                    this.modalTitulo.value = this.cartaoAbertoAtual.titulo;
                }
            });

            this.modalTitulo.addEventListener("keydown", (evento) => {
                if (evento.key === "Enter") {
                    evento.preventDefault();
                    this.modalTitulo.blur();
                }
            });
        }

        // Atualizar Data de Entrega do cartão
        if (this.modalDataEntrega) {
            this.modalDataEntrega.addEventListener("change", async () => {
                if (!this.cartaoAbertoAtual || this.cartaoAbertoAtual._isNovo) return;
                this.cartaoAbertoAtual.dataEntrega = this.modalDataEntrega.value;
                await this.bancoDeDados.atualizarPropriedadesCartao(this.cartaoAbertoAtual.id, {
                    dataEntrega: this.modalDataEntrega.value
                });
            });
        }

        // Atualizar Prioridade do cartão
        if (this.modalPrioridade) {
            this.modalPrioridade.addEventListener("change", async () => {
                if (!this.cartaoAbertoAtual || this.cartaoAbertoAtual._isNovo) return;
                this.cartaoAbertoAtual.prioridade = this.modalPrioridade.value;
                await this.bancoDeDados.atualizarPropriedadesCartao(this.cartaoAbertoAtual.id, {
                    prioridade: this.modalPrioridade.value
                });
                await this.renderizarQuadro();
            });
        }

        // Atualizar Descrição do cartão
        if (this.modalDescricao) {
            this.modalDescricao.addEventListener("change", async () => {
                if (!this.cartaoAbertoAtual || this.cartaoAbertoAtual._isNovo) return;
                this.cartaoAbertoAtual.descricao = this.modalDescricao.value.trim();
                await this.bancoDeDados.atualizarPropriedadesCartao(this.cartaoAbertoAtual.id, {
                    descricao: this.modalDescricao.value.trim()
                });
            });
        }

        // Botão de Adicionar Tarefa
        if (this.modalBotaoAdicionarTarefa) {
            this.modalBotaoAdicionarTarefa.addEventListener("click", async () => {
                await this.adicionarNovaTarefa();
            });
        }

        // Delegação de eventos na lista de tarefas (marcar como concluído, editar texto, remover)
        if (this.modalListaTarefas) {
            // Mudança no estado do checkbox (concluido)
            this.modalListaTarefas.addEventListener("change", async (evento) => {
                const checkbox = evento.target.closest(".checkbox-tarefa");
                if (checkbox) {
                    const linha = checkbox.closest(".linha-tarefa");
                    const idItem = linha.dataset.idItem;
                    const inputTexto = linha.querySelector(".input-tarefa");
                    const concluido = checkbox.checked;

                    if (inputTexto) {
                        inputTexto.classList.toggle("concluida", concluido);
                    }

                    await this.atualizarStatusItemTarefa(idItem, concluido);
                }
            });

            // Ao sair do foco do campo de descrição da tarefa (salva alterações de texto)
            this.modalListaTarefas.addEventListener("focusout", async (evento) => {
                const inputTexto = evento.target.closest(".input-tarefa");
                if (inputTexto) {
                    const linha = inputTexto.closest(".linha-tarefa");
                    const idItem = linha.dataset.idItem;
                    await this.atualizarDescricaoItemTarefa(idItem, inputTexto.value);
                }
            });

            // Tecla Enter no input da tarefa finaliza a edição salvando o foco
            this.modalListaTarefas.addEventListener("keydown", (evento) => {
                if (evento.key === "Enter") {
                    const inputTexto = evento.target.closest(".input-tarefa");
                    if (inputTexto) {
                        evento.preventDefault();
                        inputTexto.blur();
                    }
                }
            });

            // Clique no botão de remover uma tarefa específica
            this.modalListaTarefas.addEventListener("click", async (evento) => {
                const botaoRemover = evento.target.closest(".botao-remover-tarefa");
                if (botaoRemover) {
                    const linha = botaoRemover.closest(".linha-tarefa");
                    const idItem = linha.dataset.idItem;
                    await this.removerItemTarefa(idItem, linha);
                }
            });
        }
    }

    /**
     * Renderiza o quadro Kanban completo de forma virtual e performática.
     * Carrega colunas e cartões do IndexedDB em paralelo e utiliza DocumentFragment
     * para realizar uma única inserção no DOM.
     *
     * @returns {Promise<void>}
     */
    async renderizarQuadro() {
        try {
            if (!this.containerQuadro) {
                console.error("Contêiner do quadro (#quadro) não foi encontrado no documento.");
                return;
            }

            // Busca paralela no IndexedDB para diminuir a latência de carregamento
            const [colunas, cartoes, todosItens] = await Promise.all([
                this.bancoDeDados.carregarColunas(),
                this.bancoDeDados.carregarCartoes(),
                this.bancoDeDados.carregarTodosItensCartao()
            ]);

            // Limpa o conteúdo anterior do quadro
            this.containerQuadro.innerHTML = "";

            // Caso não existam colunas cadastradas, adiciona a coluna placeholder para permitir a criação imediata
            if (!colunas || colunas.length === 0) {
                this.adicionarColunaPlaceholder();
                return;
            }

            // Otimização de Performance: Agrupamento em Map O(1) de cartões por id da coluna
            const cartoesPorColuna = new Map();
            colunas.forEach((coluna) => cartoesPorColuna.set(coluna.id, []));

            cartoes.forEach((cartao) => {
                if (cartoesPorColuna.has(cartao.colunaAtual)) {
                    cartoesPorColuna.get(cartao.colunaAtual).push(cartao);
                } else {
                    console.warn(`Cartão ${cartao.id} pertence a uma coluna inexistente: ${cartao.colunaAtual}`);
                }
            });

            // Otimização de Performance: Mapeamento em Map O(1) de contagem e conclusão de subtarefas por cartão
            const estatisticasTarefas = new Map();
            if (todosItens && todosItens.length > 0) {
                todosItens.forEach((item) => {
                    if (!estatisticasTarefas.has(item.idCartao)) {
                        estatisticasTarefas.set(item.idCartao, { total: 0, concluidas: 0 });
                    }
                    const stats = estatisticasTarefas.get(item.idCartao);
                    stats.total += 1;
                    if (item.concluido) {
                        stats.concluidas += 1;
                    }
                });
            }

            // Otimização de Performance: DocumentFragment acumula as mutações fora da árvore do DOM
            const fragmentoQuadro = document.createDocumentFragment();

            colunas.forEach((coluna) => {
                const cartoesDaColuna = cartoesPorColuna.get(coluna.id) || [];
                const elementoColuna = this.criarElementoColuna(coluna, cartoesDaColuna, estatisticasTarefas);
                fragmentoQuadro.appendChild(elementoColuna);
            });

            // Insere todas as colunas de uma única vez no DOM (apenas 1 reflow/repaint)
            this.containerQuadro.appendChild(fragmentoQuadro);
        } catch (erro) {
            console.error("Erro ao renderizar o quadro Kanban:", erro);
        }
    }

    /**
     * Renderiza a mensagem e o botão de ação quando não há nenhuma coluna no banco de dados.
     */
    renderizarEstadoSemColunas() {
        const elementoEstadoVazio = document.createElement("div");
        elementoEstadoVazio.className = "estado-vazio";

        const mensagem = document.createElement("p");
        mensagem.className = "mensagem-vazio";
        mensagem.textContent = "Nenhuma coluna cadastrada no momento.";
        elementoEstadoVazio.appendChild(mensagem);

        const botaoAdicionar = document.createElement("button");
        botaoAdicionar.type = "button";
        botaoAdicionar.className = "botao-adicionar-primeira-coluna botao-acao-coluna";
        botaoAdicionar.textContent = "+ Adicionar Coluna";
        elementoEstadoVazio.appendChild(botaoAdicionar);

        this.containerQuadro.appendChild(elementoEstadoVazio);
    }

    /**
     * Cria e retorna o elemento HTML estruturado para uma coluna e seus respectivos cartões.
     *
     * @param {Coluna} coluna - Dados da coluna a ser renderizada.
     * @param {Cartao[]} cartoes - Lista de cartões associados a esta coluna.
     * @param {Map<string, {total: number, concluidas: number}>} [estatisticasTarefas=new Map()] - Estatísticas pré-carregadas de tarefas.
     * @returns {HTMLElement} Elemento <section class="coluna"> montado.
     */
    criarElementoColuna(coluna, cartoes, estatisticasTarefas = new Map()) {
        const elementoColuna = document.createElement("section");
        elementoColuna.className = "coluna";
        elementoColuna.id = `coluna-${coluna.id}`;
        elementoColuna.dataset.identificadorColuna = coluna.id;
        elementoColuna.style.setProperty("--cor-destaque-coluna", coluna.cor_destaque || "#9E9E9E");

        // 1. Cabeçalho da coluna
        const cabecalho = document.createElement("div");
        cabecalho.className = "cabecalho-coluna";

        const titulo = document.createElement("h2");
        titulo.textContent = coluna.titulo;
        titulo.dataset.idColuna = coluna.id;
        titulo.title = "Clique para editar o título da coluna";
        cabecalho.appendChild(titulo);

        // Menu de ações da coluna
        const menuAcoesColuna = document.createElement("div");
        menuAcoesColuna.className = "menu-acoes-coluna";

        const botaoMenuAcoes = document.createElement("button");
        botaoMenuAcoes.type = "button";
        botaoMenuAcoes.className = "botao-menu-acoes-coluna";
        botaoMenuAcoes.title = `Ações da coluna ${coluna.titulo}`;
        botaoMenuAcoes.setAttribute("aria-label", `Ações da coluna ${coluna.titulo}`);
        botaoMenuAcoes.setAttribute("aria-expanded", "false");
        botaoMenuAcoes.setAttribute("aria-haspopup", "true");
        botaoMenuAcoes.innerHTML = "<i class='icon icon-dots-horizontal'></i>";
        menuAcoesColuna.appendChild(botaoMenuAcoes);

        const dropdownAcoes = document.createElement("div");
        dropdownAcoes.className = "dropdown-acoes-coluna oculto";

        // Opção: Cor de destaque
        const botaoCorDestaqueColuna = document.createElement("button");
        botaoCorDestaqueColuna.type = "button";
        botaoCorDestaqueColuna.className = "botao-cor-destaque-coluna opcao-menu-coluna";
        botaoCorDestaqueColuna.title = `Alterar cor de destaque da coluna ${coluna.titulo}`;
        botaoCorDestaqueColuna.setAttribute("aria-label", `Alterar cor de destaque da coluna ${coluna.titulo}`);
        botaoCorDestaqueColuna.setAttribute("aria-expanded", "false");

        const indicadorCor = document.createElement("span");
        indicadorCor.className = "indicador-cor-atual";
        indicadorCor.style.backgroundColor = coluna.cor_destaque || "#9E9E9E";

        const textoCorDestaque = document.createElement("span");
        textoCorDestaque.textContent = "Cor de destaque";

        botaoCorDestaqueColuna.appendChild(indicadorCor);
        botaoCorDestaqueColuna.appendChild(textoCorDestaque);
        dropdownAcoes.appendChild(botaoCorDestaqueColuna);

        // Container com as opções de cores inline
        const containerSeletorCor = document.createElement("div");
        containerSeletorCor.className = "container-seletor-cor-dropdown oculto";

        const divCorDestaque = document.createElement("div");
        divCorDestaque.className = "cor-destaque";

        const containerBotoesCores = document.createElement("div");
        containerBotoesCores.className = "opcoes-cores-predefinidas";

        const coresPredefinidas = ["#9E9E9E", "#FF6D00", "#00E5FF", "#00C853"];

        const inputCorPersonalizada = document.createElement("input");
        inputCorPersonalizada.type = "color";
        inputCorPersonalizada.className = "input-cor-personalizada";
        inputCorPersonalizada.value = coluna.cor_destaque || "#9E9E9E";
        inputCorPersonalizada.title = "Escolher cor personalizada";
        inputCorPersonalizada.setAttribute("aria-label", "Escolher cor personalizada");

        const atualizarCorDestaqueColuna = async (novaCor) => {
            coluna.cor_destaque = novaCor;
            elementoColuna.style.setProperty("--cor-destaque-coluna", novaCor);
            indicadorCor.style.backgroundColor = novaCor;
            inputCorPersonalizada.value = novaCor;
            try {
                await this.bancoDeDados.atualizarPropriedadesColuna(coluna.id, { cor_destaque: novaCor });
            } catch (erro) {
                console.error("Erro ao atualizar cor de destaque da coluna:", erro);
            }
        };

        coresPredefinidas.forEach((cor) => {
            const botaoCor = document.createElement("button");
            botaoCor.type = "button";
            botaoCor.className = "botao-cor-opcao";
            botaoCor.style.backgroundColor = cor;
            botaoCor.title = `Selecionar cor ${cor}`;
            botaoCor.setAttribute("aria-label", `Selecionar cor ${cor}`);

            botaoCor.addEventListener("mousedown", (evento) => {
                evento.preventDefault();
            });

            botaoCor.addEventListener("click", async (evento) => {
                evento.stopPropagation();
                await atualizarCorDestaqueColuna(cor);
            });

            containerBotoesCores.appendChild(botaoCor);
        });

        inputCorPersonalizada.addEventListener("input", (evento) => {
            coluna.cor_destaque = evento.target.value;
            elementoColuna.style.setProperty("--cor-destaque-coluna", evento.target.value);
            indicadorCor.style.backgroundColor = evento.target.value;
        });

        inputCorPersonalizada.addEventListener("change", async (evento) => {
            await atualizarCorDestaqueColuna(evento.target.value);
        });

        divCorDestaque.appendChild(containerBotoesCores);
        divCorDestaque.appendChild(inputCorPersonalizada);
        containerSeletorCor.appendChild(divCorDestaque);
        dropdownAcoes.appendChild(containerSeletorCor);

        botaoCorDestaqueColuna.addEventListener("click", (evento) => {
            evento.stopPropagation();
            const estaOculto = containerSeletorCor.classList.toggle("oculto");
            botaoCorDestaqueColuna.setAttribute("aria-expanded", String(!estaOculto));
        });

        // Divisor visual entre Cor de Destaque e Excluir
        const divisor = document.createElement("div");
        divisor.className = "divisor-menu-coluna";
        dropdownAcoes.appendChild(divisor);

        // Opção: Excluir
        const botaoExcluirColuna = document.createElement("button");
        botaoExcluirColuna.type = "button";
        botaoExcluirColuna.className = "botao-excluir-coluna opcao-menu-coluna perigo";
        botaoExcluirColuna.title = `Excluir coluna ${coluna.titulo}`;
        botaoExcluirColuna.setAttribute("aria-label", `Excluir coluna ${coluna.titulo}`);
        botaoExcluirColuna.textContent = "Excluir";
        botaoExcluirColuna.dataset.idColuna = coluna.id;
        botaoExcluirColuna.dataset.tituloColuna = coluna.titulo;
        dropdownAcoes.appendChild(botaoExcluirColuna);

        menuAcoesColuna.appendChild(dropdownAcoes);
        cabecalho.appendChild(menuAcoesColuna);

        elementoColuna.appendChild(cabecalho);

        // 2. Lista de cartões
        const listaCartoes = document.createElement("div");
        listaCartoes.className = "lista-de-cartoes";
        listaCartoes.dataset.identificadorColuna = coluna.id;

        if (cartoes.length === 0) {
            const avisoSemCartoes = document.createElement("div");
            avisoSemCartoes.className = "aviso-sem-cartoes";
            avisoSemCartoes.textContent = "Nenhum cartão nesta coluna";
            listaCartoes.appendChild(avisoSemCartoes);
        } else {
            cartoes.forEach((cartao) => {
                const stats = estatisticasTarefas ? estatisticasTarefas.get(cartao.id) : null;
                const elementoCartao = this.criarElementoCartao(cartao, stats);
                listaCartoes.appendChild(elementoCartao);
            });
        }

        elementoColuna.appendChild(listaCartoes);

        // 3. Rodapé com botão de adicionar cartão
        const rodape = document.createElement("div");
        rodape.className = "rodape-coluna";

        const botaoAdicionar = document.createElement("button");
        botaoAdicionar.type = "button";
        botaoAdicionar.className = "botao-adicionar-cartao";
        botaoAdicionar.textContent = "Adicionar Cartão";
        botaoAdicionar.dataset.idColuna = coluna.id;
        rodape.appendChild(botaoAdicionar);

        elementoColuna.appendChild(rodape);

        return elementoColuna;
    }

    /**
     * Cria e retorna o elemento HTML correspondente a um cartão.
     *
     * @param {Cartao} cartao - Objeto com os dados do cartão a ser renderizado.
     * @param {{total: number, concluidas: number}|null} [estatisticasTarefas=null] - Quantidade total e concluída de subtarefas.
     * @returns {HTMLElement} Elemento DOM representando o cartão.
     */
    criarElementoCartao(cartao, estatisticasTarefas = null) {
        const elementoCartao = document.createElement("div");
        elementoCartao.className = "cartao";
        elementoCartao.dataset.id = cartao.id;

        const titulo = document.createElement("h3");
        titulo.textContent = cartao.titulo;
        elementoCartao.appendChild(titulo);

        // Exibição visual da prioridade do cartão com etiqueta destacada
        if (cartao.prioridade) {
            const containerPrioridade = document.createElement("span");
            containerPrioridade.className = `cartao-prioridade cartao-prioridade-${cartao.prioridade}`;
            const rotulosPrioridade = {
                alta: "Alta",
                media: "Média",
                baixa: "Baixa"
            };
            containerPrioridade.textContent = `Prioridade: ${rotulosPrioridade[cartao.prioridade] || cartao.prioridade}`;
            elementoCartao.appendChild(containerPrioridade);
        }

        if (cartao.descricao && cartao.descricao.trim() !== "") {
            const descricao = document.createElement("p");
            descricao.textContent = cartao.descricao;
            elementoCartao.appendChild(descricao);
        }

        // Se houver data de entrega definida, exibe no cartão
        if (cartao.dataEntrega) {
            const containerData = document.createElement("div");
            containerData.className = "cartao-data-entrega";
            try {
                const valorData = cartao.dataEntrega.includes("T") ? cartao.dataEntrega : `${cartao.dataEntrega}T00:00:00`;
                const dataObj = new Date(valorData);
                const formatador = new Intl.DateTimeFormat("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric"
                });
                containerData.textContent = `Entrega: ${formatador.format(dataObj)}`;
            } catch (e) {
                containerData.textContent = `Entrega: ${cartao.dataEntrega}`;
            }
            containerData.insertAdjacentHTML("afterbegin", "<i class='icon icon-calendar'></i>");
            elementoCartao.appendChild(containerData);
        }

        // Se o cartão possuir subtarefas cadastradas, exibe o indicador em uma div.tarefas
        if (estatisticasTarefas && estatisticasTarefas.total > 0) {
            const containerTarefas = document.createElement("div");
            containerTarefas.className = "tarefas";
            if (estatisticasTarefas.concluidas === estatisticasTarefas.total) {
                containerTarefas.classList.add("tarefas-concluidas");
            }
            containerTarefas.textContent = `${estatisticasTarefas.concluidas}/${estatisticasTarefas.total}`;
            if (estatisticasTarefas.concluidas == estatisticasTarefas.total) {
                containerTarefas.insertAdjacentHTML("afterbegin", "<i class='icon icon-file-check-02'></i>");
            }
            else {
                containerTarefas.insertAdjacentHTML("afterbegin", "<i class='icon icon-file-02'></i>");
            }
            elementoCartao.appendChild(containerTarefas);
        }

        return elementoCartao;
    }

    /**
     * Abre o modal popup carregando os dados do cartão, a coluna pertencente e suas subtarefas.
     *
     * @param {string} idCartao - Identificador único do cartão.
     */
    async abrirModalCartao(idCartao) {
        try {
            const [cartoes, colunas] = await Promise.all([
                this.bancoDeDados.carregarCartoes(),
                this.bancoDeDados.carregarColunas()
            ]);

            const cartao = cartoes.find((c) => c.id === idCartao);
            if (!cartao) {
                console.error(`Cartão com ID ${idCartao} não encontrado.`);
                return;
            }

            const coluna = colunas.find((col) => col.id === cartao.colunaAtual);

            this.cartaoAbertoAtual = cartao;
            this.colunaAbertaAtual = coluna;

            // Garante que o span esteja visível e o select inline oculto
            this.fecharSeletorColunaInline();

            // Preenche o cabeçalho e campos com os dados do cartão
            if (this.modalColuna) {
                this.modalColuna.textContent = coluna ? coluna.titulo : "Coluna Desconhecida";
            }
            if (this.modalTitulo) {
                this.modalTitulo.disabled = false;
                this.modalTitulo.value = cartao.titulo || "";
            }
            if (this.modalDataEntrega) {
                this.modalDataEntrega.disabled = false;
                this.modalDataEntrega.value = cartao.dataEntrega ? cartao.dataEntrega.split("T")[0] : "";
            }
            if (this.modalPrioridade) {
                this.modalPrioridade.disabled = false;
                this.modalPrioridade.value = cartao.prioridade || "baixa";
            }
            if (this.modalDescricao) {
                this.modalDescricao.disabled = false;
                this.modalDescricao.value = cartao.descricao || "";
            }

            // Garante que o botão de excluir e a seção de tarefas estejam visíveis
            if (this.modalBotaoExcluir) {
                this.modalBotaoExcluir.classList.remove("oculto");
            }
            if (this.modalSecaoTarefas) {
                this.modalSecaoTarefas.classList.remove("oculto");
            }

            // Carrega e renderiza as tarefas do cartão
            const itens = await this.bancoDeDados.carregarItensPorCartao(idCartao);
            this.renderizarListaDeTarefas(itens);

            // Exibe o popup e bloqueia o scroll do body
            if (this.modalCartao) {
                this.modalCartao.classList.remove("oculto");
                document.body.classList.add("modal-aberto");
            }
        } catch (erro) {
            console.error("Erro ao abrir modal do cartão:", erro);
        }
    }

    /**
     * Fecha o modal popup de detalhes do cartão e atualiza o quadro para sincronizar alterações.
     */
    fecharModalCartao() {
        this.fecharSeletorColunaInline();
        if (this.modalCartao) {
            this.modalCartao.classList.add("oculto");
        }
        document.body.classList.remove("modal-aberto");
        this.cartaoAbertoAtual = null;
        this.colunaAbertaAtual = null;
        this.renderizarQuadro();
    }

    /**
     * Abre o dropdown inline de seleção de coluna substituindo o span pelo select.
     */
    async abrirSeletorColunaInline() {
        if (!this.modalColunaSelect || !this.modalColuna || !this.cartaoAbertoAtual) return;

        try {
            const colunas = await this.bancoDeDados.carregarColunas();
            this.modalColunaSelect.innerHTML = "";

            colunas.forEach((coluna) => {
                const opcao = document.createElement("option");
                opcao.value = coluna.id;
                opcao.textContent = coluna.titulo;
                if (coluna.id === this.cartaoAbertoAtual.colunaAtual) {
                    opcao.selected = true;
                }
                this.modalColunaSelect.appendChild(opcao);
            });

            this.modalColuna.classList.add("oculto");
            this.modalColunaSelect.classList.remove("oculto");
            this.modalColunaSelect.focus();

            if (typeof this.modalColunaSelect.showPicker === "function") {
                try {
                    this.modalColunaSelect.showPicker();
                } catch (erroPicker) {
                    // showPicker pode ser bloqueado ou não suportado
                }
            }
        } catch (erro) {
            console.error("Erro ao carregar colunas para seleção:", erro);
        }
    }

    /**
     * Fecha o dropdown inline de seleção de coluna e volta a exibir o span com o nome da coluna.
     */
    fecharSeletorColunaInline() {
        if (!this.modalColunaSelect || !this.modalColuna) return;
        this.modalColunaSelect.classList.add("oculto");
        this.modalColuna.classList.remove("oculto");
    }

    /**
     * Altera a coluna do cartão atualmente aberto no modal e sincroniza o banco e o quadro.
     *
     * @param {string} novaColunaId - Identificador da nova coluna selecionada.
     */
    async alterarColunaCartaoAberto(novaColunaId) {
        if (!this.cartaoAbertoAtual || !novaColunaId) return;

        const colunaOrigemId = this.cartaoAbertoAtual.colunaAtual;
        if (colunaOrigemId === novaColunaId) {
            this.fecharSeletorColunaInline();
            return;
        }

        try {
            const [colunas, todosCartoes] = await Promise.all([
                this.bancoDeDados.carregarColunas(),
                this.bancoDeDados.carregarCartoes()
            ]);

            const novaColuna = colunas.find((col) => col.id === novaColunaId);
            const listaAlteracoesLote = [];

            // 1. Reindexar coluna de destino sequencialmente (0, 1, 2...) inserindo o cartão no final
            const cartoesDestino = todosCartoes.filter(
                (c) => c.colunaAtual === novaColunaId && c.id !== this.cartaoAbertoAtual.id
            );
            cartoesDestino.sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0));
            cartoesDestino.push(this.cartaoAbertoAtual);

            cartoesDestino.forEach((cartao, index) => {
                const ordemAtual = Number(cartao.ordem) || 0;
                const mudouOrdem = ordemAtual !== index;
                const ehCartaoMovido = cartao.id === this.cartaoAbertoAtual.id;

                if (ehCartaoMovido) {
                    this.cartaoAbertoAtual.colunaAtual = novaColunaId;
                    this.cartaoAbertoAtual.ordem = index;

                    if (!this.cartaoAbertoAtual._isNovo) {
                        listaAlteracoesLote.push({
                            id: cartao.id,
                            alteracoes: {
                                colunaAtual: novaColunaId,
                                ordem: index
                            }
                        });
                    }
                } else if (mudouOrdem) {
                    cartao.ordem = index;
                    listaAlteracoesLote.push({
                        id: cartao.id,
                        alteracoes: { ordem: index }
                    });
                }
            });

            // 2. Reindexar coluna de origem para fechar lacunas sequencialmente (0, 1, 2...)
            if (colunaOrigemId) {
                const cartoesOrigem = todosCartoes.filter(
                    (c) => c.colunaAtual === colunaOrigemId && c.id !== this.cartaoAbertoAtual.id
                );
                cartoesOrigem.sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0));

                cartoesOrigem.forEach((cartao, index) => {
                    const ordemAtual = Number(cartao.ordem) || 0;
                    if (ordemAtual !== index) {
                        cartao.ordem = index;
                        listaAlteracoesLote.push({
                            id: cartao.id,
                            alteracoes: { ordem: index }
                        });
                    }
                });
            }

            // 3. Persistência atômica das alterações em lote no IndexedDB
            if (listaAlteracoesLote.length > 0) {
                await this.bancoDeDados.atualizarCartoesEmLote(listaAlteracoesLote);
            }

            this.colunaAbertaAtual = novaColuna;

            if (this.modalColuna) {
                this.modalColuna.textContent = novaColuna ? novaColuna.titulo : "Coluna Desconhecida";
            }

            this.fecharSeletorColunaInline();
            if (!this.cartaoAbertoAtual._isNovo) {
                await this.renderizarQuadro();
            }
        } catch (erro) {
            console.error("Erro ao alterar coluna do cartão:", erro);
            this.fecharSeletorColunaInline();
        }
    }

    /**
     * Renderiza a lista de tarefas/subtarefas no contêiner do modal.
     *
     * @param {ItemCartao[]} itens - Lista de itens vinculados ao cartão.
     */
    renderizarListaDeTarefas(itens) {
        if (!this.modalListaTarefas) return;

        this.modalListaTarefas.innerHTML = "";

        if (!itens || itens.length === 0) {
            return;
        }

        itens.forEach((item) => {
            const elementoLinha = this.criarElementoLinhaTarefa(item);
            this.modalListaTarefas.appendChild(elementoLinha);
        });
    }

    /**
     * Cria e retorna o elemento DOM correspondente a uma linha de tarefa no modal.
     *
     * @param {ItemCartao} item - Dados do item/subtarefa.
     * @returns {HTMLElement} Linha da tarefa contendo checkbox, input e botão excluir.
     */
    criarElementoLinhaTarefa(item) {
        const linha = document.createElement("div");
        linha.className = "linha-tarefa";
        linha.dataset.idItem = item.id;

        // Checkbox de conclusão
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "checkbox-tarefa";
        checkbox.checked = Boolean(item.concluido);
        checkbox.setAttribute("aria-label", "Marcar tarefa como concluída");
        linha.appendChild(checkbox);

        // Input de descrição da tarefa
        const inputDescricao = document.createElement("input");
        inputDescricao.type = "text";
        inputDescricao.className = "input-tarefa";
        inputDescricao.value = item.descricao || "";
        inputDescricao.placeholder = "Descrição da tarefa...";
        if (item.concluido) {
            inputDescricao.classList.add("concluida");
        }
        linha.appendChild(inputDescricao);

        // Botão para remover a tarefa
        const botaoRemover = document.createElement("button");
        botaoRemover.type = "button";
        botaoRemover.className = "botao-remover-tarefa";
        botaoRemover.title = "Excluir esta tarefa";
        botaoRemover.setAttribute("aria-label", "Excluir esta tarefa");
        botaoRemover.innerHTML = '<i class="icon icon-x"></i>';
        linha.appendChild(botaoRemover);

        return linha;
    }

    /**
     * Adiciona uma nova subtarefa ao cartão atualmente aberto no modal.
     */
    async adicionarNovaTarefa() {
        if (!this.cartaoAbertoAtual || this.cartaoAbertoAtual._isNovo) return;

        try {
            const itensExistentes = await this.bancoDeDados.carregarItensPorCartao(this.cartaoAbertoAtual.id);
            const ordemNovoItem = itensExistentes.reduce((maximo, item) => {
                const ordemAtual = Number(item.ordem) || 0;
                return ordemAtual > maximo ? ordemAtual : maximo;
            }, -1) + 1;

            const novoItem = new ItemCartao({
                idCartao: this.cartaoAbertoAtual.id,
                descricao: "",
                concluido: false,
                ordem: ordemNovoItem
            });

            await this.bancoDeDados.salvarItemCartao(novoItem);

            const elementoLinha = this.criarElementoLinhaTarefa(novoItem);
            this.modalListaTarefas.appendChild(elementoLinha);

            // Coloca o foco imediatamente no input recém-criado para digitação imediata
            const inputCriado = elementoLinha.querySelector(".input-tarefa");
            if (inputCriado) {
                inputCriado.focus();
            }
        } catch (erro) {
            console.error("Erro ao adicionar nova tarefa ao cartão:", erro);
        }
    }

    /**
     * Atualiza o estado de conclusão de um item de tarefa no banco de dados.
     *
     * @param {string} idItem - Identificador único do item.
     * @param {boolean} concluido - Novo estado de conclusão.
     */
    async atualizarStatusItemTarefa(idItem, concluido) {
        if (!this.cartaoAbertoAtual) return;

        try {
            await this.bancoDeDados.atualizarPropriedadesItemCartao(idItem, { concluido: Boolean(concluido) });
        } catch (erro) {
            console.error(`Erro ao atualizar status da tarefa ${idItem}:`, erro);
        }
    }

    /**
     * Atualiza a descrição de um item de tarefa no banco de dados.
     *
     * @param {string} idItem - Identificador único do item.
     * @param {string} descricao - Novo texto de descrição.
     */
    async atualizarDescricaoItemTarefa(idItem, descricao) {
        if (!this.cartaoAbertoAtual) return;

        try {
            await this.bancoDeDados.atualizarPropriedadesItemCartao(idItem, { descricao: String(descricao || "") });
        } catch (erro) {
            console.error(`Erro ao atualizar descrição da tarefa ${idItem}:`, erro);
        }
    }

    /**
     * Exclui um item de tarefa do banco de dados e remove sua linha da interface.
     *
     * @param {string} idItem - Identificador único da tarefa.
     * @param {HTMLElement} elementoLinha - Elemento DOM da linha da tarefa.
     */
    async removerItemTarefa(idItem, elementoLinha) {
        try {
            await this.bancoDeDados.excluirItemCartao(idItem);
            if (elementoLinha) {
                elementoLinha.remove();
            }
        } catch (erro) {
            console.error(`Erro ao remover a tarefa ${idItem}:`, erro);
        }
    }

    /**
     * Adiciona ou foca uma coluna fantasma (placeholder) no contêiner do quadro.
     *
     * @returns {HTMLElement|null} Elemento da coluna placeholder criada ou focada.
     */
    adicionarColunaPlaceholder() {
        if (!this.containerQuadro) return null;

        // Se já existir uma coluna placeholder no quadro, foca no input existente
        const placeholderExistente = this.containerQuadro.querySelector(".coluna-placeholder");
        if (placeholderExistente) {
            const inputExistente = placeholderExistente.querySelector(".input-titulo-coluna-placeholder");
            if (inputExistente) {
                inputExistente.focus();
                inputExistente.select();
            }
            placeholderExistente.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "end" });
            return placeholderExistente;
        }

        const elementoPlaceholder = this.criarElementoColunaPlaceholder();
        this.containerQuadro.appendChild(elementoPlaceholder);

        const inputTitulo = elementoPlaceholder.querySelector(".input-titulo-coluna-placeholder");
        if (inputTitulo) {
            inputTitulo.focus();
        }

        elementoPlaceholder.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "end" });
        return elementoPlaceholder;
    }

    /**
     * Cria e retorna o elemento DOM correspondente a uma coluna placeholder (fantasma).
     * Contém o campo de título focado para digitação e gerencia o salvamento e cancelamento
     * substituindo o elemento no DOM, evitando repaint de todo o quadro.
     *
     * @returns {HTMLElement} Elemento <section class="coluna coluna-placeholder"> montado.
     */
    criarElementoColunaPlaceholder() {
        const elementoColuna = document.createElement("section");
        elementoColuna.className = "coluna coluna-placeholder";

        // 1. Cabeçalho com o campo de texto para o título da coluna
        const cabecalho = document.createElement("div");
        cabecalho.className = "cabecalho-coluna";

        const inputTitulo = document.createElement("input");
        inputTitulo.type = "text";
        inputTitulo.className = "input-titulo-coluna-placeholder";
        inputTitulo.placeholder = "Nome da coluna...";
        inputTitulo.setAttribute("aria-label", "Nome da nova coluna");
        inputTitulo.autocomplete = "off";
        cabecalho.appendChild(inputTitulo);

        elementoColuna.appendChild(cabecalho);

        // 1.5. Seletor de cor de destaque para a coluna
        const divCorDestaque = document.createElement("div");
        divCorDestaque.className = "cor-destaque";

        const corPadrao = "#9E9E9E";
        let corDestaqueSelecionada = corPadrao;
        elementoColuna.style.setProperty("--cor-destaque-coluna", corPadrao);

        const containerBotoesCores = document.createElement("div");
        containerBotoesCores.className = "opcoes-cores-predefinidas";

        const coresPredefinidas = ["#9E9E9E", "#FF6D00", "#00E5FF", "#00C853"];

        const inputCorPersonalizada = document.createElement("input");
        inputCorPersonalizada.type = "color";
        inputCorPersonalizada.className = "input-cor-personalizada";
        inputCorPersonalizada.value = corPadrao;
        inputCorPersonalizada.title = "Escolher cor personalizada";
        inputCorPersonalizada.setAttribute("aria-label", "Escolher cor personalizada");

        const atualizarCorDestaque = (cor) => {
            corDestaqueSelecionada = cor;
            elementoColuna.style.setProperty("--cor-destaque-coluna", cor);
            inputCorPersonalizada.value = cor;
        };

        coresPredefinidas.forEach((cor) => {
            const botaoCor = document.createElement("button");
            botaoCor.type = "button";
            botaoCor.className = "botao-cor-opcao";
            botaoCor.style.backgroundColor = cor;
            botaoCor.title = `Selecionar cor ${cor}`;
            botaoCor.setAttribute("aria-label", `Selecionar cor ${cor}`);

            botaoCor.addEventListener("mousedown", (evento) => {
                evento.preventDefault();
            });

            botaoCor.addEventListener("click", () => {
                atualizarCorDestaque(cor);
            });

            containerBotoesCores.appendChild(botaoCor);
        });

        inputCorPersonalizada.addEventListener("input", (evento) => {
            corDestaqueSelecionada = evento.target.value;
            elementoColuna.style.setProperty("--cor-destaque-coluna", evento.target.value);
        });
        inputCorPersonalizada.addEventListener("change", (evento) => {
            corDestaqueSelecionada = evento.target.value;
            elementoColuna.style.setProperty("--cor-destaque-coluna", evento.target.value);
        });

        divCorDestaque.appendChild(containerBotoesCores);
        divCorDestaque.appendChild(inputCorPersonalizada);

        elementoColuna.appendChild(divCorDestaque);

        // 2. Corpo visual vazio indicando a criação da coluna
        const corpoVazio = document.createElement("div");
        corpoVazio.className = "placeholder-corpo-vazio";

        const textoInstrucao = document.createElement("span");
        textoInstrucao.textContent = "Nova Coluna";

        const dica = document.createElement("span");
        dica.className = "placeholder-dica";

        const botaoCriar = document.createElement("button");
        botaoCriar.type = "button";
        botaoCriar.className = "botao-criar-coluna";
        botaoCriar.textContent = "Criar";
        botaoCriar.title = "Criar coluna";
        botaoCriar.setAttribute("aria-label", "Criar coluna");

        botaoCriar.addEventListener("mousedown", (evento) => {
            // Evita que o clique retire o foco abruptamente do input antes da ação
            evento.preventDefault();
        });

        botaoCriar.addEventListener("click", async () => {
            await salvar();
        });

        dica.appendChild(botaoCriar);

        corpoVazio.appendChild(textoInstrucao);
        corpoVazio.appendChild(dica);
        elementoColuna.appendChild(corpoVazio);

        let processado = false;

        const salvar = async () => {
            if (processado) return;
            const titulo = inputTitulo.value.trim();

            if (!titulo) {
                inputTitulo.focus();
                return;
            }

            processado = true;
            inputTitulo.disabled = true;

            try {
                const colunasExistentes = await this.bancoDeDados.carregarColunas();
                const ordemNovaColuna = colunasExistentes.reduce((maximo, col) => {
                    const ordemAtual = Number(col.ordem) || 0;
                    return ordemAtual > maximo ? ordemAtual : maximo;
                }, -1) + 1;

                const novaColuna = new Coluna({
                    titulo: titulo,
                    ordem: ordemNovaColuna,
                    cor_destaque: corDestaqueSelecionada || corPadrao
                });

                await this.bancoDeDados.salvarColunas(novaColuna);

                // Cria o elemento da coluna definitiva e substitui o placeholder diretamente, evitando repaint
                const elementoColunaDefinitiva = this.criarElementoColuna(novaColuna, []);
                elementoColuna.replaceWith(elementoColunaDefinitiva);
            } catch (erro) {
                console.error("Erro ao salvar nova coluna:", erro);
                processado = false;
                inputTitulo.disabled = false;
                inputTitulo.focus();
            }
        };

        const cancelar = () => {
            if (processado) return;
            const outrasColunas = this.containerQuadro.querySelectorAll(".coluna:not(.coluna-placeholder)");
            if (outrasColunas.length > 0) {
                processado = true;
                elementoColuna.remove();
            } else {
                inputTitulo.value = "";
                inputTitulo.blur();
            }
        };

        inputTitulo.addEventListener("keydown", (evento) => {
            if (evento.key === "Enter") {
                evento.preventDefault();
            } else if (evento.key === "Escape") {
                evento.preventDefault();
                cancelar();
            }
        });

        const descartarSeVazio = () => {
            if (processado) return;
            const titulo = inputTitulo.value.trim();
            if (!titulo) {
                cancelar();
            }
        };

        inputTitulo.addEventListener("blur", (evento) => {
            if (evento.relatedTarget && elementoColuna.contains(evento.relatedTarget)) {
                return;
            }
            descartarSeVazio();
        });

        elementoColuna.addEventListener("focusout", (evento) => {
            if (!elementoColuna.contains(evento.relatedTarget)) {
                descartarSeVazio();
            }
        });

        return elementoColuna;
    }

    /**
     * Inicia a criação de uma nova coluna criando uma coluna fantasma (placeholder)
     * interativa diretamente no DOM.
     */
    solicitarNovaColuna() {
        this.adicionarColunaPlaceholder();
    }

    /**
     * Verifica se o cartão aberto é recém-criado e, caso seja, habilita os demais campos
     * e torna a seção de tarefas disponível, sincronizando o quadro.
     */
    async verificarCartaoNovoCriado() {
        if (!this.cartaoAbertoAtual || !this.cartaoAbertoAtual._isNovo) return;

        this.cartaoAbertoAtual._isNovo = false;

        // Habilita os demais campos do modal
        if (this.modalDataEntrega) {
            this.modalDataEntrega.disabled = false;
        }
        if (this.modalPrioridade) {
            this.modalPrioridade.disabled = false;
        }
        if (this.modalDescricao) {
            this.modalDescricao.disabled = false;
        }

        // Torna a seção de tarefas e o botão de excluir visíveis
        if (this.modalBotaoExcluir) {
            this.modalBotaoExcluir.classList.remove("oculto");
        }
        if (this.modalSecaoTarefas) {
            this.modalSecaoTarefas.classList.remove("oculto");
        }

        // Renderiza o quadro para exibir o novo cartão criado na coluna correspondente
        await this.renderizarQuadro();
    }

    /**
     * Abre o modal popup em modo de criação para adicionar um novo cartão na coluna informada.
     * Inicialmente, desabilita os demais campos e oculta a seção de tarefas até a definição do título.
     *
     * @param {string} identificadorColuna - Identificador da coluna no banco de dados.
     */
    async solicitarNovoCartao(identificadorColuna) {
        try {
            const [colunas, todosCartoes] = await Promise.all([
                this.bancoDeDados.carregarColunas(),
                this.bancoDeDados.carregarCartoes()
            ]);

            const coluna = colunas.find((c) => c.id === identificadorColuna);
            const cartoesDestaColuna = todosCartoes.filter(
                (c) => c.colunaAtual === identificadorColuna
            );

            const ordemNovoCartao = cartoesDestaColuna.reduce((maximo, c) => {
                const ordemAtual = Number(c.ordem) || 0;
                return ordemAtual > maximo ? ordemAtual : maximo;
            }, -1) + 1;

            // Cria uma nova instância de Cartao em memória
            const novoCartao = new Cartao({
                titulo: "",
                descricao: "",
                dataEntrega: "",
                prioridade: "baixa",
                colunaAtual: identificadorColuna,
                ordem: ordemNovoCartao
            });
            novoCartao._isNovo = true;

            this.cartaoAbertoAtual = novoCartao;
            this.colunaAbertaAtual = coluna;

            // Garante que o seletor inline de coluna esteja fechado
            this.fecharSeletorColunaInline();

            // Configura o cabeçalho e reseta os campos
            if (this.modalColuna) {
                this.modalColuna.textContent = coluna ? coluna.titulo : "Coluna Desconhecida";
            }
            if (this.modalTitulo) {
                this.modalTitulo.disabled = false;
                this.modalTitulo.value = "";
            }
            if (this.modalDataEntrega) {
                this.modalDataEntrega.disabled = true;
                this.modalDataEntrega.value = "";
            }
            if (this.modalPrioridade) {
                this.modalPrioridade.disabled = true;
                this.modalPrioridade.value = "baixa";
            }
            if (this.modalDescricao) {
                this.modalDescricao.disabled = true;
                this.modalDescricao.value = "";
            }

            // Oculta a seção de tarefas e o botão de excluir inicialmente durante a criação
            if (this.modalBotaoExcluir) {
                this.modalBotaoExcluir.classList.add("oculto");
            }
            if (this.modalSecaoTarefas) {
                this.modalSecaoTarefas.classList.add("oculto");
            }

            // Limpa a lista de tarefas no modal
            this.renderizarListaDeTarefas([]);

            // Exibe o popup do modal e bloqueia o scroll do body
            if (this.modalCartao) {
                this.modalCartao.classList.remove("oculto");
                document.body.classList.add("modal-aberto");
            }

            // Foca o campo de título para agilizar o preenchimento imediato
            if (this.modalTitulo) {
                requestAnimationFrame(() => {
                    this.modalTitulo.focus();
                });
            }
        } catch (erro) {
            console.error("Erro ao preparar criação de novo cartão:", erro);
        }
    }

    /**
     * Remove um cartão do banco de dados e atualiza a interface.
     *
     * @param {string} id - Identificador único do cartão.
     */
    async excluirCartao(id) {
        try {
            await this.bancoDeDados.excluirCartao(id);
            await this.renderizarQuadro();
        } catch (erro) {
            console.error(`Erro ao excluir o cartão ${id}:`, erro);
        }
    }

    /**
     * Remove uma coluna e seus cartões vinculados do banco de dados e atualiza a interface.
     *
     * @param {string} id - Identificador único da coluna.
     */
    async excluirColuna(id) {
        try {
            await this.bancoDeDados.excluirColuna(id);
            await this.renderizarQuadro();
        } catch (erro) {
            console.error(`Erro ao excluir a coluna ${id}:`, erro);
        }
    }

    /**
     * Torna o título de uma coluna editável (contenteditable) e persiste a alteração no IndexedDB.
     *
     * @param {HTMLElement} elementoTitulo - Elemento <h2> dentro do cabeçalho da coluna.
     */
    tornarTituloColunaEditavel(elementoTitulo) {
        if (!elementoTitulo || elementoTitulo.isContentEditable) return;

        const elementoColuna = elementoTitulo.closest(".coluna");
        const idColuna = elementoTitulo.dataset.idColuna || (elementoColuna ? elementoColuna.dataset.identificadorColuna : null);
        if (!idColuna) return;

        const tituloOriginal = elementoTitulo.textContent.trim();
        let cancelado = false;

        elementoTitulo.contentEditable = "true";
        elementoTitulo.focus();

        // Seleciona o conteúdo de texto para digitação direta
        try {
            const selecao = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(elementoTitulo);
            selecao.removeAllRanges();
            selecao.addRange(range);
        } catch (erroSelecao) {
            // Em caso de falha silenciosa de seleção
        }

        const manipularKeydown = (evento) => {
            if (evento.key === "Enter") {
                evento.preventDefault();
                elementoTitulo.blur();
            } else if (evento.key === "Escape") {
                evento.preventDefault();
                cancelado = true;
                elementoTitulo.blur();
            }
        };

        const finalizarEdicao = async () => {
            elementoTitulo.removeEventListener("keydown", manipularKeydown);
            elementoTitulo.contentEditable = "false";

            if (cancelado) {
                elementoTitulo.textContent = tituloOriginal;
                return;
            }

            const novoTitulo = elementoTitulo.textContent.trim();
            if (!novoTitulo || novoTitulo === tituloOriginal) {
                elementoTitulo.textContent = tituloOriginal;
                return;
            }

            elementoTitulo.textContent = novoTitulo;

            try {
                await this.bancoDeDados.atualizarPropriedadesColuna(idColuna, { titulo: novoTitulo });

                // Atualiza o botão de excluir e outros atributos dependentes do título
                if (elementoColuna) {
                    const botaoMenu = elementoColuna.querySelector(".botao-menu-acoes-coluna");
                    if (botaoMenu) {
                        botaoMenu.title = `Ações da coluna ${novoTitulo}`;
                        botaoMenu.setAttribute("aria-label", `Ações da coluna ${novoTitulo}`);
                    }

                    const botaoExcluir = elementoColuna.querySelector(".botao-excluir-coluna");
                    if (botaoExcluir) {
                        botaoExcluir.title = `Excluir coluna ${novoTitulo}`;
                        botaoExcluir.setAttribute("aria-label", `Excluir coluna ${novoTitulo}`);
                        botaoExcluir.dataset.tituloColuna = novoTitulo;
                    }
                }
            } catch (erro) {
                console.error(`Erro ao salvar título da coluna ${idColuna}:`, erro);
                elementoTitulo.textContent = tituloOriginal;
            }
        };

        elementoTitulo.addEventListener("keydown", manipularKeydown);
        elementoTitulo.addEventListener("blur", finalizarEdicao, { once: true });
    }
}

// Expõe a classe globalmente no navegador
if (typeof window !== "undefined") {
    window.GerenciadorDeInterface = GerenciadorDeInterface;
}

// Suporte para ambientes de módulo (ex: testes unitários com Node.js)
if (typeof module !== "undefined" && module.exports) {
    module.exports = { GerenciadorDeInterface };
}
