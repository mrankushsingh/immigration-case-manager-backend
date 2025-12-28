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

  // Get comprehensive monthly summary
  fastify.get('/monthly-summary', async (request: AuthenticatedRequest, reply) => {
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
      
      // Initialize counters
      const activeClientIds = new Set<string>();
      let totalPayments = 0;
      let totalPaymentReceived = 0;
      let totalAdvance = 0;
      let totalDue = 0;
      const clientsWhoPaid = new Set<string>();
      
      // Iterate through all clients
      for (const client of clients) {
        if (!client.payment?.payments || !Array.isArray(client.payment.payments)) {
          continue;
        }
        
        const totalFee = client.payment.totalFee || 0;
        let runningPaidAmount = 0;
        
        // Process payments in chronological order
        const sortedPayments = [...client.payment.payments].sort((a, b) => {
          return new Date(a.date).getTime() - new Date(b.date).getTime();
        });
        
        for (const payment of sortedPayments) {
          if (!payment || !payment.date || !payment.amount) {
            continue;
          }
          
          const paymentDate = new Date(payment.date);
          
          // Check if payment is in the target month and year
          if (
            paymentDate.getMonth() === targetMonth &&
            paymentDate.getFullYear() === targetYear
          ) {
            const paymentAmount = Number(payment.amount) || 0;
            
            // Count all payments
            totalPayments++;
            
            // Calculate what was due before this payment
            const dueBeforePayment = totalFee - runningPaidAmount;
            
            // Determine payment status and advance
            if (paymentAmount > 0) {
              // Payment received (status = 'paid')
              totalPaymentReceived += paymentAmount;
              clientsWhoPaid.add(client.id);
              
              // Check if this is an advance payment
              // Advance = payment made when already fully paid OR excess over due amount
              if (runningPaidAmount >= totalFee) {
                // Client already fully paid, this is advance
                totalAdvance += paymentAmount;
              } else if (paymentAmount > dueBeforePayment) {
                // Payment exceeds due amount, excess is advance
                const advanceAmount = paymentAmount - dueBeforePayment;
                totalAdvance += advanceAmount;
                totalDue += dueBeforePayment; // The due portion
              } else {
                // Normal payment, not advance
                totalDue += paymentAmount;
              }
              
              runningPaidAmount += paymentAmount;
            }
          } else {
            // Payment not in target month, but update running total for advance calculation
            runningPaidAmount += Number(payment.amount) || 0;
          }
        }
        
        // Check if client is active (has payments or created in this month)
        const createdDate = new Date(client.created_at);
        if (
          (createdDate.getMonth() === targetMonth && createdDate.getFullYear() === targetYear) ||
          sortedPayments.some(p => {
            const pDate = new Date(p.date);
            return pDate.getMonth() === targetMonth && pDate.getFullYear() === targetYear;
          })
        ) {
          activeClientIds.add(client.id);
        }
      }
      
      return reply.send({
        totalClients: activeClientIds.size,
        totalPayments: totalPayments,
        totalPaymentReceived: totalPaymentReceived,
        totalAdvance: totalAdvance,
        totalDue: totalDue,
        clientsWhoPaid: clientsWhoPaid.size,
        month: targetMonth + 1, // Return 1-indexed month
        year: targetYear,
      });
    } catch (error: any) {
      fastify.log.error('Error fetching monthly summary:', error);
      return reply.status(500).send({ 
        error: error.message || 'Failed to fetch monthly summary' 
      });
    }
  });
};

export default analyticsRoutes;

