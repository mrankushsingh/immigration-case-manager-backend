import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../utils/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

const memoryDb = db;

const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get payments summary for a specific month
  fastify.get('/payments-summary', async (request: AuthenticatedRequest, reply) => {
    try {
      const { month, year } = request.query as { month?: string; year?: string };
      
      // Default to current month if not provided
      const now = new Date();
      const targetMonth = month ? parseInt(month, 10) - 1 : now.getMonth(); // month is 0-indexed
      const targetYear = year ? parseInt(year, 10) : now.getFullYear();
      
      // Validate month and year
      if (targetMonth < 0 || targetMonth > 11) {
        return reply.status(400).send({ error: 'Invalid month. Must be between 1 and 12' });
      }
      if (targetYear < 2000 || targetYear > 2100) {
        return reply.status(400).send({ error: 'Invalid year' });
      }
      
      // Get all clients
      const clients = await memoryDb.getClients();
      
      let totalAmount = 0;
      let paymentCount = 0;
      
      // Iterate through all clients and their payments
      for (const client of clients) {
        if (client.payment?.payments && Array.isArray(client.payment.payments)) {
          for (const payment of client.payment.payments) {
            if (payment && payment.date && payment.amount) {
              const paymentDate = new Date(payment.date);
              
              // Check if payment is in the target month and year
              if (
                paymentDate.getMonth() === targetMonth &&
                paymentDate.getFullYear() === targetYear
              ) {
                totalAmount += Number(payment.amount) || 0;
                paymentCount++;
              }
            }
          }
        }
      }
      
      return reply.send({
        totalAmount: totalAmount,
        paymentCount: paymentCount,
        month: targetMonth + 1, // Return 1-indexed month
        year: targetYear,
      });
    } catch (error: any) {
      fastify.log.error('Error fetching payments summary:', error);
      return reply.status(500).send({ 
        error: error.message || 'Failed to fetch payments summary' 
      });
    }
  });
};

export default analyticsRoutes;

