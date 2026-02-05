function appData() {
    return {
        // ========== VARIABLES DE ESTADO ==========
        view: 'login',
        username: '',
        password: '',
        loading: false,
        error: '',
        user: null,
        mesas: [],
        categorias: [],
        productos: [],
        selectedCategory: null,
        ticketId: null,
        pedido: [],
        mesaId: null,
        total: 0,
        currentProduct: null,
        quantity: 1,
        notes: '',
        showProductsModal: false,
        socket: socket,

        // ========== INICIALIZACIÓN DEL COMPONENTE ==========
        init() {
            // Recuperar usuario del localStorage si existe
            const savedUser = localStorage.getItem('user');
            if (savedUser) {
                this.user = JSON.parse(savedUser);
                this.view = 'menu';
                this.cargarMesas();
                this.cargarCategorias();
            }

            // Configurar listeners de Socket.IO
            if (socket) {
                socket.on('pedido-actualizado', ({ mesaId }) => {
                    if (this.mesaId === mesaId && this.view === 'mesa') {
                        this.cargarPedido();
                    }
                });

                socket.on('mesas-actualizadas', () => {
                    this.cargarMesas();
                });
            }
        },

        // ========== MÉTODOS DE AUTENTICACIÓN ==========
        async login() {
            this.loading = true;
            this.error = '';
            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: this.username.trim(),
                        password: this.password
                    })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Credenciales inválidas');

                localStorage.setItem('user', JSON.stringify(data.user));
                this.user = data.user;
                this.view = 'menu';
                this.cargarMesas();
                this.cargarCategorias();
            } catch (err) {
                this.error = err.message;
            } finally {
                this.loading = false;
            }
        },

        logout() {
            localStorage.clear();
            this.user = null;
            this.view = 'login';
        },

        // ========== MÉTODOS DE DATOS (API) ==========
        async cargarMesas() {
            try {
                const res = await fetch('/api/mesas');
                this.mesas = await res.json();
            } catch (err) {
                console.error('Error al cargar mesas:', err);
            }
        },

        async cargarCategorias() {
            try {
                const res = await fetch('/api/categorias');
                this.categorias = await res.json();
                if (this.categorias.length > 0) {
                    this.selectedCategory = this.categorias[0].id;
                    await this.cargarProductos(this.categorias[0].id);
                }
            } catch (err) {
                console.error('Error al cargar categorías:', err);
            }
        },

        async cargarProductos(catId) {
            this.selectedCategory = catId;
            this.showProductsModal = true;
            try {
                const res = await fetch(`/api/productos/${catId}`);
                this.productos = await res.json();
            } catch (err) {
                console.error('Error al cargar productos:', err);
            }
        },

        cerrarModalProductos() {
            this.showProductsModal = false;
        },
        async abrirMesa(mesaId) {
            this.mesaId = mesaId;
            try {
                const res = await fetch(`/api/mesa/${encodeURIComponent(mesaId)}/ticket`);
                const data = await res.json();

                if (data.error) throw new Error(data.error);

                this.ticketId = data.ticketId;
                this.view = 'mesa';

                if (socket) socket.emit('unir-mesa', mesaId);
                await this.cargarPedido();
            } catch (err) {
                alert('Error: ' + err.message);
            }
        },

        async cargarPedido() {
            if (!this.mesaId) return;
            try {
                const res = await fetch(`/api/mesa/${encodeURIComponent(this.mesaId)}/pedidos`);
                if (!res.ok) throw new Error('No se pudo obtener el pedido');

                const data = await res.json();
                this.pedido = data.map(item => ({
                    ...item,
                    qty: item.cantidad || item.qty
                }));

                this.calcularTotal();
            } catch (err) {
                console.error('Error al cargar pedido:', err);
            }
        },

        showModal(prod) {
            this.currentProduct = prod;
            this.quantity = 1;
            this.notes = '';
        },

        async agregarProducto() {
            if (!this.currentProduct || !this.mesaId) return;

            const productData = {
                mesaId: this.mesaId,
                productoId: this.currentProduct.id,
                cantidad: this.quantity,
                price: this.currentProduct.price,
                taxid: '001',
                notes: this.notes
            };

            try {
                if (socket && socket.connected) {
                    socket.emit('agregar-producto', productData);
                } else {
                    const res = await fetch('/api/pedidos/agregar', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(productData)
                    });
                    if (res.ok) await this.cargarPedido();
                }
                this.currentProduct = null;
                this.quantity = 1;
                this.notes = '';
                this.showProductsModal = false;
            } catch (err) {
                alert('No se pudo agregar el producto: ' + err.message);
            }
        },

        async cerrarMesa() {
            if (!confirm('¿Deseas cerrar la cuenta de esta mesa?')) return;

            try {
                const res = await fetch(`/api/mesa/${encodeURIComponent(this.mesaId)}/cerrar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mesaId: this.mesaId,
                        ticketId: this.ticketId,
                        total: this.total
                    })
                });

                if (res.ok) {
                    alert('Mesa cerrada correctamente');
                    this.volverMenu();
                } else {
                    const error = await res.json();
                    throw new Error(error.error || 'Error desconocido');
                }
            } catch (err) {
                alert('Error al cerrar mesa: ' + err.message);
            }
        },

        volverMenu() {
            // Si estamos en la vista de mesa, volver a mesas
            if (this.view === 'mesa') {
                this.view = 'mesas';
            } else {
                // Si estamos en otras vistas, volver al menú
                this.view = 'menu';
            }
            this.mesaId = null;
            this.ticketId = null;
            this.pedido = [];
            this.total = 0;
            this.currentProduct = null;
            this.quantity = 1;
            this.notes = '';
            this.showProductsModal = false;
            this.cargarMesas();
        },

        async guardarNota(idx) {
            const item = this.pedido[idx];
            if (item) {
                console.log(`Nota actualizada para ${item.name}:`, item.notes);
            }
        },

        imprimirRecibo() {
            window.print();
        },

        calcularTotal() {
            this.total = this.pedido.reduce((sum, item) => {
                return sum + (parseFloat(item.price) * parseFloat(item.qty || item.cantidad));
            }, 0);
        }
    ,

        queueAction(type, data) {
            let queue = JSON.parse(localStorage.getItem('offline_queue') || '[]');
            queue.push({ type, data, timestamp: Date.now() });
            localStorage.setItem('offline_queue', JSON.stringify(queue));
            alert('Acción guardada localmente (sin conexión)');
        }
    };
};