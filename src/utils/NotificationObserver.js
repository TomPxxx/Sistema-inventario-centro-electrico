// Patron Observer para Notificaciones (SSE)

class NotificationObserver {
  constructor() {
    this.clients = new Set();
  }

  // Suscribir un nuevo cliente (conexión SSE)
  subscribe(req, res) {
    // Configurar cabeceras para Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Enviar conexión inicial exitosa
    res.write('data: {"type": "CONNECTED", "message": "Suscrito a notificaciones en tiempo real"}\n\n');

    const client = { req, res };
    this.clients.add(client);

    console.log(`[Observer] Cliente suscrito. Total: ${this.clients.size}`);

    // Si el cliente se desconecta
    req.on('close', () => {
      this.clients.delete(client);
      console.log(`[Observer] Cliente desconectado. Total: ${this.clients.size}`);
    });
  }

  // Notificar a todos los clientes
  notifyAll(data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      client.res.write(payload);
    }
  }

  // Notificar a clientes de una sede específica (y administradores)
  notifySede(data, sedeId) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      const user = client.req.user;
      // Notificar si el usuario es el destinatario o si es administrador
      if (user && (user.rol === 'ADMINISTRADOR' || user.sede_id === sedeId)) {
        client.res.write(payload);
      }
    }
  }
}

export const notificationSystem = new NotificationObserver();
