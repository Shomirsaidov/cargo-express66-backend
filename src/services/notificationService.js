const transporter = require('../config/email');
const { supabaseAdmin } = require('../config/supabase');
require('dotenv').config();

const STATUS_MESSAGES = {
  received_at_warehouse: {
    title: 'Parcel Received / Посылка на складе',
    message: (tracking) => `Your parcel ${tracking} has been received at our warehouse. / Ваша посылка ${tracking} получена на нашем складе.`,
    emailSubject: 'Your parcel has arrived at the warehouse / Ваша посылка прибыла на склад',
  },
  dispatched: {
    title: 'Parcel Dispatched / Посылка отправлена',
    message: (tracking) => `Your parcel ${tracking} has been dispatched and is on its way. / Ваша посылка ${tracking} отправлена и находится в пути.`,
    emailSubject: 'Your parcel has been dispatched / Ваша посылка отправлена',
  },
  in_transit: {
    title: 'Parcel In Transit / Посылка в пути',
    message: (tracking, awb) => awb 
      ? `Your parcel ${tracking} is in transit on flight ${awb}. / Ваша посылка ${tracking} в пути, рейс ${awb}.`
      : `Your parcel ${tracking} is currently in transit. / Ваша посылка ${tracking} в пути.`,
    emailSubject: 'Your parcel is in transit / Ваша посылка в пути',
  },
  arrived_in_dushanbe: {
    title: 'Parcel Arrived in Dushanbe / Посылка прибыла в Душанбе',
    message: (tracking, awb) => awb
      ? `Your parcel ${tracking} has arrived in Dushanbe on flight ${awb}. / Ваша посылка ${tracking} прибыла в Душанбе рейсом ${awb}.`
      : `Your parcel ${tracking} has arrived in Dushanbe. / Ваша посылка ${tracking} прибыла в Душанбе.`,
    emailSubject: 'Your parcel has arrived in Dushanbe / Ваша посылка прибыла в Душанбе',
  },
  customs_clearance: {
    title: 'Parcel in Customs / Посылка на таможне',
    message: (tracking) => `Your parcel ${tracking} is undergoing customs clearance. / Ваша посылка ${tracking} проходит таможенную очистку.`,
    emailSubject: 'Your parcel is at customs / Ваша посылка на таможне',
  },
  ready_for_pickup: {
    title: 'Parcel Ready for Pickup / Посылка готова к выдаче',
    message: (tracking) => `Your parcel ${tracking} is ready for pickup at our office. / Ваша посылка ${tracking} готова к выдаче в нашем офисе.`,
    emailSubject: 'Your parcel is ready for pickup / Ваша посылка готова к выдаче',
  },
  delivered: {
    title: 'Parcel Delivered / Посылка доставлена',
    message: (tracking) => `Your parcel ${tracking} has been successfully delivered. / Ваша посылка ${tracking} успешно доставлена.`,
    emailSubject: 'Your parcel has been delivered / Ваша посылка доставлена',
  },
};

/**
 * Create a notification record in the database
 */
const createNotification = async ({ customer_id, title, message, type = 'info', parcel_id = null }) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .insert({ customer_id, title, message, type, parcel_id, is_read: false })
      .select()
      .single();

    if (error) {
      console.error('Failed to create notification:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('createNotification error:', err);
    return null;
  }
};

/**
 * Send email via nodemailer
 */
const sendEmail = async ({ to, subject, html, text }) => {
  try {
    if (!process.env.SMTP_USER || process.env.SMTP_USER === 'your-email@gmail.com') {
      console.warn('Email not configured — skipping send to:', to);
      return false;
    }

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'Cargo Express 66 <noreply@cargoexpress66.com>',
      to,
      subject,
      text,
      html,
    });

    console.log('Email sent:', info.messageId);
    return true;
  } catch (err) {
    console.error('sendEmail error:', err.message);
    return false;
  }
};

/**
 * Send notification for parcel status change
 */
const notifyParcelStatus = async (parcel, status) => {
  try {
    const template = STATUS_MESSAGES[status];
    if (!template) return; // No notification template for this status

    // Fetch customer info
    const { data: customer, error } = await supabaseAdmin
      .from('customers')
      .select('id, first_name, last_name, email')
      .eq('id', parcel.customer_id)
      .single();

    if (error || !customer) {
      console.warn('Cannot notify: customer not found for parcel', parcel.id);
      return;
    }

    const awbNumber = parcel.awb_number || parcel.airway_bills?.awb_number || null;
    const message = template.message(parcel.tracking_number, awbNumber);

    // Create in-app notification
    await createNotification({
      customer_id: customer.id,
      title: template.title,
      message,
      type: 'shipment',
      parcel_id: parcel.id,
    });

    // Send email
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #6997CF; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">Cargo Express 66</h1>
        </div>
        <div style="padding: 30px; background-color: #f9f9f9;">
          <h2 style="color: #333;">${template.title}</h2>
          <p style="color: #555; font-size: 16px;">Dear ${customer.first_name} ${customer.last_name},</p>
          <p style="color: #555; font-size: 16px;">${message}</p>
          <div style="background-color: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>Tracking Number:</strong> ${parcel.tracking_number}</p>
            <p style="margin: 5px 0;"><strong>Status:</strong> ${status.replace(/_/g, ' ').toUpperCase()}</p>
          </div>
          <p style="color: #888; font-size: 14px;">Thank you for choosing Cargo Express 66.</p>
        </div>
        <div style="background-color: #333; padding: 15px; text-align: center;">
          <p style="color: #aaa; margin: 0; font-size: 12px;">&copy; 2024 Cargo Express 66. All rights reserved.</p>
        </div>
      </div>
    `;

    await sendEmail({
      to: customer.email,
      subject: template.emailSubject,
      html,
      text: message,
    });
  } catch (err) {
    console.error('notifyParcelStatus error:', err);
  }
};

module.exports = { sendEmail, createNotification, notifyParcelStatus };
