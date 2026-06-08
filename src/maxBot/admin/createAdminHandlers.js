const { createShowUserMainMenu } = require("../showUserMainMenu");
const { clearAdminScenario } = require("./helpers");
const { createCoreHandlers } = require("./domains/core");
const { createBookingsHandlers } = require("./domains/bookings");
const { createBroadcastHandlers } = require("./domains/broadcast");
const { createRevenueHandlers } = require("./domains/revenue");
const { createScheduleHandlers } = require("./domains/schedule");
const { createServicesHandlers } = require("./domains/services");
const { createSettingsHandlers } = require("./domains/settings");

function createAdminHandlers(adapter, sheetsService, bookingService, bot) {
  const config = adapter.config;
  const showUserMainMenu = createShowUserMainMenu(adapter);

  const core = createCoreHandlers({ adapter, config, showUserMainMenu });

  const menus = {
    showMainMenu: core.showMainMenu,
    showSettingsMenu: core.showSettingsMenu,
    showScheduleMenu: core.showScheduleMenu,
    showServicesMenu: core.showServicesMenu,
  };

  const adminCtx = {
    adapter,
    sheetsService,
    bookingService,
    bot,
    config,
    showUserMainMenu,
    menus,
  };

  const bookings = createBookingsHandlers(adminCtx);
  const broadcast = createBroadcastHandlers(adminCtx);
  const revenue = createRevenueHandlers(adminCtx);
  const schedule = createScheduleHandlers(adminCtx);
  const services = createServicesHandlers(adminCtx);
  const settings = createSettingsHandlers(adminCtx);

  const domains = { bookings, broadcast, revenue, schedule, services, settings };

  return {
    checkAdmin: core.checkAdmin,
    replyNoAccess: core.replyNoAccess,
    showMainMenu: core.showMainMenu,
    handleAdminCancel: core.handleAdminCancel,
    handleAdminCallback: core.createHandleAdminCallback(domains),
    handleRevenueCallback: revenue.handleRevenueCallback,
    handleServiceEditCallback: services.handleServiceEditCallback,
    handleServiceFieldCallback: services.handleServiceFieldCallback,
    handleServiceDeleteCallback: services.handleServiceDeleteCallback,
    handleAdminText: core.createHandleAdminText(domains),
    handleAdminImage: core.createHandleAdminImage(domains),
    clearAdminScenario,
  };
}

module.exports = { createAdminHandlers };
