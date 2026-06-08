const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezonePlugin = require("dayjs/plugin/timezone");
const revenueStats = require("../../../services/revenueStats");
const { formatDate } = require("../../../utils/formatDate");
const {
  buildMainMenuKeyboard,
  buildRevenueMenuKeyboard,
} = require("../keyboards");

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

function createRevenueHandlers({ adapter, sheetsService, menus }) {
  const showRevenueMenu = async (ctx) => {
    await adapter.reply(ctx, "Выберите период для просмотра статистики:", {
      attachments: [buildRevenueMenuKeyboard()],
    });
  };

  const handleRevenueCallback = async (ctx, period) => {
    if (period === "back") {
      await menus.showMainMenu(ctx);
      return;
    }

    try {
      const timezone = await sheetsService.getTimezone();
      let startDate = null;
      let endDate = null;
      let periodLabel = "";
      const now = dayjs().tz(timezone);

      switch (period) {
        case "today":
          startDate = now.startOf("day").format("YYYY-MM-DD");
          endDate = now.endOf("day").format("YYYY-MM-DD");
          periodLabel = formatDate(startDate);
          break;
        case "yesterday": {
          const yesterday = now.subtract(1, "day");
          startDate = yesterday.startOf("day").format("YYYY-MM-DD");
          endDate = yesterday.endOf("day").format("YYYY-MM-DD");
          periodLabel = formatDate(startDate);
          break;
        }
        case "this_week": {
          const monday = now.startOf("week").add(1, "day");
          startDate = monday.format("YYYY-MM-DD");
          endDate = now.format("YYYY-MM-DD");
          periodLabel = `с ${formatDate(startDate)} по ${formatDate(endDate)}`;
          break;
        }
        case "last_week": {
          const lastMonday = now
            .subtract(1, "week")
            .startOf("week")
            .add(1, "day");
          const lastSunday = lastMonday.add(6, "day");
          startDate = lastMonday.format("YYYY-MM-DD");
          endDate = lastSunday.format("YYYY-MM-DD");
          periodLabel = `с ${formatDate(startDate)} по ${formatDate(endDate)}`;
          break;
        }
        case "this_month":
          startDate = now.startOf("month").format("YYYY-MM-DD");
          endDate = now.format("YYYY-MM-DD");
          periodLabel = `${now.format("MMMM YYYY")} (по ${formatDate(endDate)})`;
          break;
        case "last_month": {
          const lastMonth = now.subtract(1, "month");
          startDate = lastMonth.startOf("month").format("YYYY-MM-DD");
          endDate = lastMonth.endOf("month").format("YYYY-MM-DD");
          periodLabel = lastMonth.format("MMMM YYYY");
          break;
        }
        case "by_services":
          startDate = null;
          endDate = null;
          periodLabel = "все время";
          break;
        default:
          await adapter.reply(ctx, "Неизвестный период.", {
            attachments: [buildRevenueMenuKeyboard()],
          });
          return;
      }

      const appointments = await sheetsService.getCompletedAppointments({
        startDate,
        endDate,
      });

      let extraMetrics = null;
      if (startDate || endDate) {
        const [cancelledAppointments, newClientsCount] = await Promise.all([
          sheetsService.getCancelledAppointmentsInPeriod({ startDate, endDate }),
          sheetsService.getNewClientsCountInPeriod({ startDate, endDate }),
        ]);
        extraMetrics = {
          newClientsCount,
          cancelledCount: cancelledAppointments.length,
        };
      }

      const stats = revenueStats.calculateRevenueStats(appointments);
      const formatted = revenueStats.formatRevenueStats(
        stats,
        periodLabel,
        extraMetrics,
      );

      await adapter.reply(ctx, formatted, {
        attachments: [buildRevenueMenuKeyboard()],
      });
    } catch (error) {
      console.error("Ошибка при получении статистики доходов:", error);
      await adapter.reply(
        ctx,
        `Ошибка при получении статистики: ${
          error.message || "Неизвестная ошибка"
        }`,
        { attachments: [buildRevenueMenuKeyboard()] },
      );
    }
  };

  return {
    showRevenueMenu,
    handleRevenueCallback,
  };
}

module.exports = { createRevenueHandlers };
