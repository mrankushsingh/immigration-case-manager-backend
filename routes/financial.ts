import { FastifyPluginAsync } from 'fastify';
import { db } from '../utils/database.js';
const memoryDb = db;

const financialRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/summary', async (request, reply) => {
    try {
      const clients = await memoryDb.getClients();
      
      let totalRevenue = 0;
      let totalPaid = 0;
      let totalPending = 0;
      const paymentMethods: Record<string, { count: number; totalAmount: number }> = {};
      const clientTotals: Record<string, { name: string; totalPaid: number; paymentCount: number }> = {};
      const monthlyData: Record<string, { totalIncome: number; totalPaid: number; clientCount: number; paymentCount: number }> = {};

      clients.forEach((client: any) => {
        const clientName = `${client.first_name} ${client.last_name}`;
        const clientId = client.id;
        
        const clientTotalPaid = client.payment?.paidAmount || 0;
        const clientPaymentCount = client.payment?.payments?.length || 0;
        
        totalRevenue += client.payment?.totalFee || 0;
        totalPaid += clientTotalPaid;
        totalPending += (client.payment?.totalFee || 0) - clientTotalPaid;

        if (clientTotalPaid > 0) {
          if (!clientTotals[clientId]) {
            clientTotals[clientId] = {
              name: clientName,
              totalPaid: 0,
              paymentCount: 0,
            };
          }
          clientTotals[clientId].totalPaid += clientTotalPaid;
          clientTotals[clientId].paymentCount += clientPaymentCount;
        }

        if (client.payment?.payments && Array.isArray(client.payment.payments)) {
          client.payment.payments.forEach((payment: any) => {
            const method = payment.method || 'Unknown';
            const amount = payment.amount || 0;
            
            if (!paymentMethods[method]) {
              paymentMethods[method] = { count: 0, totalAmount: 0 };
            }
            paymentMethods[method].count += 1;
            paymentMethods[method].totalAmount += amount;

            if (payment.date) {
              const date = new Date(payment.date);
              const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
              
              if (!monthlyData[monthKey]) {
                monthlyData[monthKey] = {
                  totalIncome: 0,
                  totalPaid: 0,
                  clientCount: 0,
                  paymentCount: 0,
                };
              }
              monthlyData[monthKey].totalIncome += client.payment?.totalFee || 0;
              monthlyData[monthKey].totalPaid += amount;
              monthlyData[monthKey].paymentCount += 1;
            }
          });
        }

        if (client.created_at) {
          const date = new Date(client.created_at);
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          if (!monthlyData[monthKey]) {
            monthlyData[monthKey] = {
              totalIncome: 0,
              totalPaid: 0,
              clientCount: 0,
              paymentCount: 0,
            };
          }
          monthlyData[monthKey].clientCount += 1;
        }
      });

      const monthlyArray = Object.entries(monthlyData)
        .map(([month, data]) => ({
          month,
          totalIncome: data.totalIncome,
          totalPaid: data.totalPaid,
          pendingAmount: data.totalIncome - data.totalPaid,
          clientCount: data.clientCount,
          paymentCount: data.paymentCount,
        }))
        .sort((a, b) => a.month.localeCompare(b.month));

      const paymentMethodsArray = Object.entries(paymentMethods)
        .map(([method, data]) => ({
          method,
          count: data.count,
          totalAmount: data.totalAmount,
          percentage: totalPaid > 0 ? (data.totalAmount / totalPaid) * 100 : 0,
        }))
        .sort((a, b) => b.totalAmount - a.totalAmount);

      const topClients = Object.entries(clientTotals)
        .map(([clientId, data]) => ({
          clientId,
          clientName: data.name,
          totalPaid: data.totalPaid,
          paymentCount: data.paymentCount,
        }))
        .sort((a, b) => b.totalPaid - a.totalPaid)
        .slice(0, 10);

      const averagePayment = totalPaid > 0 && paymentMethodsArray.length > 0
        ? totalPaid / paymentMethodsArray.reduce((sum, pm) => sum + pm.count, 0)
        : 0;

      const summary = {
        totalRevenue,
        totalPaid,
        totalPending,
        totalClients: clients.length,
        averagePayment,
        monthlyData: monthlyArray,
        paymentMethods: paymentMethodsArray,
        topClients,
      };

      return reply.send(summary);
    } catch (error: any) {
      fastify.log.error('Error fetching financial summary:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch financial summary' });
    }
  });
};

export default financialRoutes;
