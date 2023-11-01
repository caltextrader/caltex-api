import Investment from "./models/Investment";
import cron from "node-cron";
import Transaction from "./models/Transaction";

export default (app, port = process.env.PORT) => {
  app.listen(port, () => {
    console.log(`App listening on port ${port}`);

    cron.schedule("0 0 * * *", function() {
      (async () => {
        const today = new Date();

        // before the end of today
        today.setHours(23, 59, 59, 999);

        const invs = await Investment.find({
          endDate: {
            $gte: new Date(),
            $lte: today
          },
          matured: false
        });

        for (const inv of invs) {
          await inv.updateOne({
            matured: true
          });

          await new Transaction({
            user: inv.user,
            autoGenerated: true,
            currency: "USD",
            paymentType: "fiat",
            amount: inv.roi,
            description: `Automatic deposit of ${
              inv.roiPct
            }% return on investment for ${inv.description || " an investment "}`
          }).save();
        }
      })();
    });
  });
};
