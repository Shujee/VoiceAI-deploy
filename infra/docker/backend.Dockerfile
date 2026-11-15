FROM php:8.3-apache

ARG UID=1000
ARG GID=1000

RUN groupmod -g ${GID} www-data \
  && usermod -u ${UID} -g ${GID} www-data

RUN apt-get update && apt-get install -y \
  git \
  curl \
  unzip \
  zip \
  libpq-dev \
  libzip-dev \
  libicu-dev \
  libonig-dev \
  libxml2-dev \
  libpng-dev \
  libjpeg62-turbo-dev \
  libfreetype6-dev \
  && docker-php-ext-configure gd --with-freetype --with-jpeg \
  && docker-php-ext-install \
  pdo_pgsql \
  zip \
  intl \
  mbstring \
  exif \
  pcntl \
  bcmath \
  gd \
  && a2enmod rewrite \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# RUN pecl install redis \
#   && docker-php-ext-enable redis

RUN sed -ri -e 's!/var/www/html!/var/www/html/public!g' \
  /etc/apache2/sites-available/*.conf \
  /etc/apache2/apache2.conf \
  /etc/apache2/conf-available/*.conf

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

RUN mkdir -p /var/www/.composer \
  && chown -R www-data:www-data /var/www/.composer

ENV COMPOSER_HOME=/var/www/.composer
